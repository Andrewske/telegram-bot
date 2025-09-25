import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import dayjs from 'dayjs';
import { BaseHandler, BaseEntry } from './base-handler.js';
import { appendToJsonl, updateJsonlEntry, uploadFile, generateMonthlyFilePath } from '../lib/jsonl-storage.js';
import { MessageHandler } from '../lib/message-router.js';

const FoodParseSchema = z.object({
  food_description: z.string().describe('Description of the food consumed'),
  context: z.string().nullable().optional().describe('Eating context: alone, with_bre, with_friends, at_work, while_working, in_kitchen, on_couch, standing_up, etc.'),
  work_state: z.enum(['actively_working', 'on_break', 'done_for_day', 'not_work_day']).nullable().optional().describe('Current work state'),
  current_activity: z.enum(['working', 'watching_tv', 'pacing_restless', 'lying_down', 'socializing', 'tidying_organizing', 'scrolling_phone', 'cooking_preparing']).nullable().optional().describe('What the person is doing right now'),
  eating_trigger: z.enum(['timer_reminder', 'stomach_growling', 'saw_food', 'felt_should', 'stress_bored', 'celebration_social']).nullable().optional().describe('Why the person is eating right now'),
});

const FoodResponseParseSchema = z.object({
  context: z.string().nullable().optional().describe('Eating context if mentioned'),
  work_state: z.enum(['actively_working', 'on_break', 'done_for_day', 'not_work_day']).nullable().optional().describe('Work state if mentioned'),
  current_activity: z.enum(['working', 'watching_tv', 'pacing_restless', 'lying_down', 'socializing', 'tidying_organizing', 'scrolling_phone', 'cooking_preparing']).nullable().optional().describe('Current activity if mentioned'),
  eating_trigger: z.enum(['timer_reminder', 'stomach_growling', 'saw_food', 'felt_should', 'stress_bored', 'celebration_social']).nullable().optional().describe('Eating trigger if mentioned'),
});

interface FoodEntry extends BaseEntry {
  food_description: string;
  context?: string | null;
  work_state?: 'actively_working' | 'on_break' | 'done_for_day' | 'not_work_day' | null;
  current_activity?: 'working' | 'watching_tv' | 'pacing_restless' | 'lying_down' | 'socializing' | 'tidying_organizing' | 'scrolling_phone' | 'cooking_preparing' | null;
  eating_trigger?: 'timer_reminder' | 'stomach_growling' | 'saw_food' | 'felt_should' | 'stress_bored' | 'celebration_social' | null;
  photo_filename?: string;
}

class FoodHandler extends BaseHandler implements MessageHandler {
  prefix = 'food';
  folderName = 'diet/food-journal';

  async handleMessage(
    message: string,
    userId: string,
    messageId: number,
    timezone: string,
    replyToMessageId?: number
  ): Promise<{ response: string; shouldUpdateCheckin?: boolean }> {
    try {
      // If this is a reply to a previous message, try to update existing entry
      if (replyToMessageId) {
        const updateResult = await this.handleFoodResponse(
          message,
          replyToMessageId,
          timezone
        );

        if (updateResult.success) {
          return {
            response: updateResult.response,
            shouldUpdateCheckin: true,
          };
        }
      }

      // This is a new food entry
      return await this.handleNewFoodEntry(message, userId, messageId, timezone);
    } catch (error) {
      console.error('Error in food handler:', error);
      return {
        response: "Sorry, I had trouble processing your food entry. Please try again.",
        shouldUpdateCheckin: true,
      };
    }
  }

  async handlePhoto(
    photoBuffer: Buffer,
    caption: string,
    userId: string,
    messageId: number,
    timezone: string
  ): Promise<{ response: string; shouldUpdateCheckin?: boolean }> {
    try {
      // Process the food entry first
      const result = await this.handleNewFoodEntry(caption, userId, messageId, timezone, true);

      // Parse the food description to generate filename
      const strippedMessage = this.stripPrefix(caption);
      const timeInfo = this.parseTimeFromMessage(strippedMessage, timezone);
      const parsedData = await this.parseFoodMessage(strippedMessage);

      // Generate photo filename
      const photoFilename = this.generatePhotoFilename(
        parsedData.food_description,
        new Date(),
        'jpg'
      );

      // Upload photo
      const photoPath = `${this.folderName}/photos/${photoFilename}`;
      await uploadFile(photoPath, photoBuffer, `Add food photo: ${photoFilename}`);

      // Update the entry with photo filename
      const filePath = generateMonthlyFilePath(this.folderName, new Date());
      await updateJsonlEntry(filePath, messageId, { photo_filename: photoFilename });

      return {
        response: result.response + "\n\nPhoto saved! 📸",
        shouldUpdateCheckin: true,
      };
    } catch (error) {
      console.error('Error handling food photo:', error);
      return {
        response: "I saved your food entry but had trouble with the photo. Please try again.",
        shouldUpdateCheckin: true,
      };
    }
  }

  private async handleNewFoodEntry(
    message: string,
    userId: string,
    messageId: number,
    timezone: string,
    hasPhoto: boolean = false
  ): Promise<{ response: string; shouldUpdateCheckin?: boolean }> {
    const strippedMessage = this.stripPrefix(message);
    const timeInfo = this.parseTimeFromMessage(strippedMessage, timezone);

    // Parse the food message using LLM
    const parsedData = await this.parseFoodMessage(strippedMessage);

    // Create food entry
    const entry: FoodEntry = {
      ...this.createBaseEntry(messageId, timezone, timeInfo),
      food_description: parsedData.food_description,
      context: parsedData.context || undefined,
      work_state: parsedData.work_state || undefined,
      current_activity: parsedData.current_activity || undefined,
      eating_trigger: parsedData.eating_trigger || undefined,
    };

    // Save to JSONL
    const filePath = generateMonthlyFilePath(this.folderName, new Date());
    await appendToJsonl(filePath, entry);

    // Check what fields are missing and ask for them
    const missingFields = this.getMissingFields(parsedData);

    let response = `Got it! Logged: ${parsedData.food_description} at ${timeInfo.time}`;

    if (missingFields.length > 0) {
      const question = this.formatMissingFieldsQuestion(missingFields);
      response += `\n\n${question}`;
    }

    return {
      response,
      shouldUpdateCheckin: true,
    };
  }

  private async handleFoodResponse(
    message: string,
    originalMessageId: number,
    timezone: string
  ): Promise<{ success: boolean; response: string }> {
    try {
      // Parse the response for missing field information
      const parsedResponse = await this.parseFoodResponse(message);

      // Update the existing entry
      const filePath = generateMonthlyFilePath(this.folderName, new Date());
      const updated = await updateJsonlEntry(filePath, originalMessageId, parsedResponse);

      if (updated) {
        const responseFields: string[] = [];
        if (parsedResponse.context && parsedResponse.context !== null) responseFields.push(`context: ${parsedResponse.context}`);
        if (parsedResponse.work_state && parsedResponse.work_state !== null) {
          responseFields.push(`work state: ${parsedResponse.work_state.replace('_', ' ')}`);
        }
        if (parsedResponse.current_activity && parsedResponse.current_activity !== null) {
          responseFields.push(`activity: ${parsedResponse.current_activity.replace('_', ' ')}`);
        }
        if (parsedResponse.eating_trigger && parsedResponse.eating_trigger !== null) {
          responseFields.push(`trigger: ${parsedResponse.eating_trigger.replace('_', ' ')}`);
        }

        const responseText = responseFields.length > 0
          ? `Updated your food entry with ${responseFields.join(', ')}. Thanks!`
          : "Thanks for the additional info!";

        return {
          success: true,
          response: responseText,
        };
      } else {
        return {
          success: false,
          response: "I couldn't find the original food entry to update.",
        };
      }
    } catch (error) {
      console.error('Error parsing food response:', error);
      return {
        success: false,
        response: "I had trouble understanding your response. Could you try again?",
      };
    }
  }

  private async parseFoodMessage(message: string): Promise<z.infer<typeof FoodParseSchema>> {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      // Fallback parsing without LLM
      return {
        food_description: message,
      };
    }

    try {
      const result = await generateObject({
        model: openai('gpt-4o-mini'),
        system: `You are parsing food journal entries. Extract the food description and any mentioned behavioral context.

Use ONLY these exact values:
- Context: alone, with_bre, with_friends, at_work, while_working, in_kitchen, on_couch, standing_up
- Work state: actively_working, on_break, done_for_day, not_work_day
- Current activity: working, watching_tv, pacing_restless, lying_down, socializing, tidying_organizing, scrolling_phone, cooking_preparing
- Eating trigger: timer_reminder, stomach_growling, saw_food, felt_should, stress_bored, celebration_social

Key mappings:
- "pacing" or "pacing around" → pacing_restless
- "with Bre" → with_bre
- "scrolling" or "on phone" → scrolling_phone
- "cleaning" or "organizing" → tidying_organizing

Examples:
- "8am bowl of cereal alone while working" → food_description: "bowl of cereal", context: "alone", current_activity: "working"
- "lunch with Bre, saw pizza and grabbed a slice" → food_description: "lunch", context: "with_bre", eating_trigger: "saw_food"
- "snack on couch, done with work, stomach growling" → food_description: "snack", context: "on_couch", work_state: "done_for_day", eating_trigger: "stomach_growling"
- "snack while pacing, stomach was growling" → food_description: "snack", current_activity: "pacing_restless", eating_trigger: "stomach_growling"

Only extract what's explicitly mentioned. Use exact enum values only.`,
        prompt: `Parse this food entry: "${message}"`,
        schema: FoodParseSchema,
      });

      return result.object;
    } catch (error) {
      console.error('LLM food parsing failed:', error);
      return {
        food_description: message,
      };
    }
  }

  private async parseFoodResponse(message: string): Promise<z.infer<typeof FoodResponseParseSchema>> {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return {};
    }

    try {
      const result = await generateObject({
        model: openai('gpt-4o-mini'),
        system: `You are parsing responses to food journal follow-up questions. Extract any mentioned behavioral information.

Use ONLY these exact values:
- Context: alone, with_bre, with_friends, at_work, while_working, in_kitchen, on_couch, standing_up
- Work state: actively_working, on_break, done_for_day, not_work_day
- Current activity: working, watching_tv, pacing_restless, lying_down, socializing, tidying_organizing, scrolling_phone, cooking_preparing
- Eating trigger: timer_reminder, stomach_growling, saw_food, felt_should, stress_bored, celebration_social

Key mappings:
- "pacing" or "pacing around" → pacing_restless
- "with Bre" → with_bre
- "scrolling" or "on phone" → scrolling_phone

Examples:
- "with friends, was pacing around, saw the food" → context: "with_friends", current_activity: "pacing_restless", eating_trigger: "saw_food"
- "alone, done working, stomach growling" → context: "alone", work_state: "done_for_day", eating_trigger: "stomach_growling"
- "on break, scrolling phone" → work_state: "on_break", current_activity: "scrolling_phone"

Use exact enum values only.`,
        prompt: `Parse this response: "${message}"`,
        schema: FoodResponseParseSchema,
      });

      return result.object;
    } catch (error) {
      console.error('LLM response parsing failed:', error);
      return {};
    }
  }

  private getMissingFields(parsedData: z.infer<typeof FoodParseSchema>): string[] {
    const missing: string[] = [];

    if (!parsedData.context || parsedData.context === null) missing.push('context');
    if (!parsedData.work_state || parsedData.work_state === null) missing.push('work_state');
    if (!parsedData.current_activity || parsedData.current_activity === null) missing.push('current_activity');
    if (!parsedData.eating_trigger || parsedData.eating_trigger === null) missing.push('eating_trigger');

    return missing;
  }
}

export const handler = new FoodHandler();