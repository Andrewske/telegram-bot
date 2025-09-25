import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface BaseEntry {
  message_id: number;
  date: string;
  time: string;
  created_at: string;
}

export abstract class BaseHandler {
  abstract prefix: string;
  abstract folderName: string;

  canHandle(message: string): boolean {
    return message.toLowerCase().startsWith(`${this.prefix}:`);
  }

  protected stripPrefix(message: string): string {
    return message.substring(this.prefix.length + 1).trim();
  }

  protected parseTimeFromMessage(message: string, timezone: string): { time: string; date: string } {
    const now = dayjs().tz(timezone);
    let parsedTime = now;

    // Look for time patterns in the message
    const timePatterns = [
      // "8am", "8:30am", "08:00", etc.
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
      /\b(\d{1,2}):(\d{2})\b/,
      // "this morning", "earlier", etc. - keep current time for these
    ];

    for (const pattern of timePatterns) {
      const match = message.match(pattern);
      if (match) {
        let hour = parseInt(match[1]);
        const minute = match[2] ? parseInt(match[2]) : 0;
        const ampm = match[3]?.toLowerCase();

        if (ampm === 'pm' && hour !== 12) {
          hour += 12;
        } else if (ampm === 'am' && hour === 12) {
          hour = 0;
        }

        parsedTime = now.hour(hour).minute(minute).second(0);
        break;
      }
    }

    return {
      time: parsedTime.format('HH:mm'),
      date: parsedTime.format('YYYY-MM-DD'),
    };
  }

  protected extractNameFromDescription(description: string): string {
    // Simple extraction for filename - take first few meaningful words
    const words = description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 0)
      .slice(0, 4); // Take first 4 words max

    return words.join('-') || 'item';
  }

  protected generatePhotoFilename(
    description: string,
    timestamp: Date,
    extension: string = 'jpg'
  ): string {
    const dateStr = dayjs(timestamp).format('YYYY-MM-DD-HH-mm-ss');
    const nameStr = this.extractNameFromDescription(description);
    return `${dateStr}-${nameStr}.${extension}`;
  }

  protected createBaseEntry(
    messageId: number,
    timezone: string,
    parsedTime?: { time: string; date: string }
  ): BaseEntry {
    const timeInfo = parsedTime || {
      time: dayjs().tz(timezone).format('HH:mm'),
      date: dayjs().tz(timezone).format('YYYY-MM-DD'),
    };

    return {
      message_id: messageId,
      date: timeInfo.date,
      time: timeInfo.time,
      created_at: dayjs().toISOString(),
    };
  }

  protected formatMissingFieldsQuestion(missingFields: string[]): string {
    if (missingFields.length === 0) return '';

    const fieldDescriptions: Record<string, string> = {
      context: 'eating context (alone/with Bre/with friends/at work/etc)',
      work_state: 'work state (still working/on break/done for day/not work day)',
      current_activity: 'current activity (what are you doing right now?)',
      eating_trigger: 'eating trigger (why are you eating?)',
    };

    const fieldQuestions: Record<string, string> = {
      context: 'Where/with whom are you eating?',
      work_state: 'Are you still working, on break, done for the day, or is it not a work day?',
      current_activity: 'What are you doing right now? (working, watching TV, pacing, lying down, etc.)',
      eating_trigger: 'Why are you eating? (timer/reminder, stomach growling, saw food, felt you should, stress/boredom, celebration)',
    };

    // Use specific questions for behavioral fields, fallback to generic format
    if (missingFields.length === 1) {
      const field = missingFields[0];
      return fieldQuestions[field] || `What's your ${fieldDescriptions[field] || field}?`;
    } else if (missingFields.length === 2) {
      const questions = missingFields.map(field =>
        fieldQuestions[field] || `${fieldDescriptions[field] || field}?`
      );
      return `${questions[0]} Also, ${questions[1].toLowerCase()}`;
    } else {
      // For multiple fields, ask them one by one with the first question
      const firstField = missingFields[0];
      return fieldQuestions[firstField] || `What's your ${fieldDescriptions[firstField] || firstField}?`;
    }
  }
}