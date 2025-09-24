import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import dayjs from 'dayjs';
import { BaseHandler, BaseEntry } from './base-handler.js';
import { appendToJsonl, updateJsonlEntry, uploadFile, generateMonthlyFilePath } from '../lib/jsonl-storage.js';
import { MessageHandler } from '../lib/message-router.js';

const FoodParseSchema = z.object({
  food_description: z.string().describe('Description of the food consumed'),
  context: z.string().optional().describe('Eating context: alone, with Bre, with friends, etc.'),
  energy_level: z.number().min(1).max(10).optional().describe('Energy level from 1-10'),
  mood: z.string().optional().describe('Current mood'),
  hunger_level: z.number().min(1).max(10).optional().describe('Hunger level from 1-10'),
});

const FoodResponseParseSchema = z.object({
  context: z.string().optional().describe('Eating context if mentioned'),
  energy_level: z.number().min(1).max(10).optional().describe('Energy level if mentioned'),
  mood: z.string().optional().describe('Mood if mentioned'),
  hunger_level: z.number().min(1).max(10).optional().describe('Hunger level if mentioned'),
});

interface FoodEntry extends BaseEntry {
  food_description: string;
  context?: string;
  energy_level?: number;
  mood?: string;
  hunger_level?: number;
  photo_filename?: string;
}

class FoodHandler extends BaseHandler implements MessageHandler {
  prefix = 'food';
  folderName = 'food-journal';

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
      context: parsedData.context,
      energy_level: parsedData.energy_level,
      mood: parsedData.mood,
      hunger_level: parsedData.hunger_level,
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
        if (parsedResponse.context) responseFields.push(`context: ${parsedResponse.context}`);
        if (parsedResponse.energy_level) responseFields.push(`energy: ${parsedResponse.energy_level}/10`);
        if (parsedResponse.mood) responseFields.push(`mood: ${parsedResponse.mood}`);
        if (parsedResponse.hunger_level) responseFields.push(`hunger: ${parsedResponse.hunger_level}/10`);

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
        system: `You are parsing food journal entries. Extract the food description and any mentioned context, energy level (1-10), mood, or hunger level (1-10).

Examples:
- "8am bowl of cereal alone" → food_description: "bowl of cereal", context: "alone"
- "lunch with Bre, feeling tired, energy 4" → food_description: "lunch", context: "with Bre", mood: "tired", energy_level: 4
- "pizza slice, was starving (hunger 8)" → food_description: "pizza slice", hunger_level: 8

Only extract what's explicitly mentioned. Don't infer or guess values.`,
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
        system: `You are parsing responses to food journal follow-up questions. Extract any mentioned context, energy level (1-10), mood, or hunger level (1-10).

The user was asked about missing information from their food entry and is providing those details.

Examples:
- "with friends, energy 7, happy" → context: "with friends", energy_level: 7, mood: "happy"
- "alone, hungry 6" → context: "alone", hunger_level: 6
- "tired, 4" → mood: "tired", energy_level: 4

Only extract what's explicitly mentioned.`,
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

    if (!parsedData.context) missing.push('context');
    if (!parsedData.energy_level) missing.push('energy_level');
    if (!parsedData.mood) missing.push('mood');
    if (!parsedData.hunger_level) missing.push('hunger_level');

    return missing;
  }
}

export const handler = new FoodHandler();