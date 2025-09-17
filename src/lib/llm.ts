import { openai } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const ResponseSchema = z.object({
  response_text: z.string().describe('Conversational response to send to the user'),
  next_checkin_minutes: z.number().min(5).max(1440).describe('Minutes until next check-in (5-1440)'),
  activity_summary: z.string().describe('Brief summary of what the user is doing'),
  context_tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
});

type LLMResponse = z.infer<typeof ResponseSchema>;

export async function processUserMessage(
  message: string,
  hasPhoto: boolean = false,
  recentContext?: string,
  userTimezone: string = 'America/Los_Angeles'
): Promise<LLMResponse> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const currentTime = dayjs().tz(userTimezone).format('YYYY-MM-DD HH:mm');
  const contextPrompt = recentContext ? `\n\nRecent context from Telegram:\n${recentContext}` : '';
  const photoNote = hasPhoto ? ' (User sent a photo with this message)' : '';

  const systemPrompt = `You are a personal life historian assistant. Your job is to:

1. Help the user document their daily activities and experiences
2. Respond conversationally and supportively
3. Schedule intelligent follow-ups based on what they're doing
4. Be encouraging and show genuine interest in their life

Current time: ${currentTime}${contextPrompt}

Guidelines:
- Be conversational and friendly, like a supportive friend
- Ask follow-up questions when appropriate
- Adjust check-in timing based on the activity:
  - Work/focus sessions: 60-120 minutes
  - Meals/short activities: 30-60 minutes
  - Events/social activities: 2-4 hours
  - Rest/sleep: 8-12 hours
- For events (concerts, meetings, etc.), wait until after they're likely done to follow up
- Show genuine interest and ask contextual questions

The user message${photoNote}: "${message}"

Respond with a JSON object containing your conversational response and next check-in timing.`;

  try {
    const result = await generateObject({
      model: openai('gpt-4o-mini'),
      system: systemPrompt,
      prompt: `Process this user message and respond appropriately: "${message}"`,
      schema: ResponseSchema,
    });

    return result.object;
  } catch (error) {
    console.error('LLM processing failed:', error);

    // Fallback response
    return {
      response_text: "Got it! I've recorded that for you.",
      next_checkin_minutes: 60,
      activity_summary: message.slice(0, 100),
      context_tags: [],
    };
  }
}

export async function generateCheckinMessage(
  userTimezone: string,
  lastActivity?: string
): Promise<string> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return "What are you up to?";
  }

  const currentTime = dayjs().tz(userTimezone).format('YYYY-MM-DD HH:mm');
  const lastActivityContext = lastActivity ? `\n\nLast recorded activity: ${lastActivity}` : '';

  const systemPrompt = `You are a personal life historian assistant checking in with the user.

Current time: ${currentTime}${lastActivityContext}

Generate a brief, friendly check-in message. Consider:
- Time of day (morning, afternoon, evening)
- Their last activity if provided
- Keep it conversational and not robotic
- Vary your messages to avoid repetition
- Be encouraging and show genuine interest

Examples:
- "How's your day going so far?"
- "What's keeping you busy right now?"
- "Hope you're having a good one! What are you working on?"
- "Quick check-in - what's on your mind today?"

Generate a single, brief check-in message:`;

  try {
    const result = await generateText({
      model: openai('gpt-4o-mini'),
      system: systemPrompt,
      prompt: 'Generate a check-in message for the user.',
    });

    return result.text.trim();
  } catch (error) {
    console.error('Check-in message generation failed:', error);
    return "What are you up to?";
  }
}