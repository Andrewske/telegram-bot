import { getDueCheckins } from './lib/db.js';
import { generateCheckinMessage } from './lib/llm.js';
import { sendMessage } from './lib/telegram.js';
import dayjs from 'dayjs';

let schedulerInterval: Timer | null = null;

export function startScheduler(): void {
  if (schedulerInterval) {
    console.log('Scheduler already running');
    return;
  }

  console.log('Starting check-in scheduler...');

  // Check for due check-ins every minute
  schedulerInterval = setInterval(async () => {
    try {
      await processCheckIns();
    } catch (error) {
      console.error('Error in scheduler:', error);
    }
  }, 60 * 1000); // 60 seconds

  console.log('Scheduler started - checking every minute for due check-ins');
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('Scheduler stopped');
  }
}

async function processCheckIns(): Promise<void> {
  try {
    const dueCheckIns = await getDueCheckins();

    if (dueCheckIns.length === 0) {
      return; // No due check-ins
    }

    console.log(`Processing ${dueCheckIns.length} due check-ins...`);

    for (const userState of dueCheckIns) {
      try {
        await sendCheckIn(userState);
      } catch (error) {
        console.error(`Failed to send check-in to user ${userState.user_id}:`, error);
      }
    }
  } catch (error) {
    console.error('Error processing check-ins:', error);
  }
}

async function sendCheckIn(userState: any): Promise<void> {
  const userId = userState.user_id.toString();
  const timezone = userState.timezone || 'America/Los_Angeles';

  console.log(`Sending check-in to user ${userId}`);

  try {
    // Generate contextual check-in message
    const message = await generateCheckinMessage(timezone);

    // Send the message
    await sendMessage(userId, message);

    // Update next check-in to 1 hour from now (default)
    // The user's response will update this based on their activity
    const { updateNextCheckin } = await import('./lib/db.js');
    const nextCheckin = dayjs().add(1, 'hour').toDate();
    await updateNextCheckin(userId, nextCheckin);

    console.log(`Check-in sent to ${userId}, next check-in scheduled for ${nextCheckin.toISOString()}`);
  } catch (error) {
    console.error(`Failed to send check-in to ${userId}:`, error);

    // Schedule retry in 5 minutes on failure
    const { updateNextCheckin } = await import('./lib/db.js');
    const retryTime = dayjs().add(5, 'minutes').toDate();
    await updateNextCheckin(userId, retryTime);

    console.log(`Retry scheduled for ${userId} at ${retryTime.toISOString()}`);
  }
}

// Health check function for the scheduler
export function getSchedulerStatus(): { running: boolean; nextCheck: string } {
  return {
    running: schedulerInterval !== null,
    nextCheck: dayjs().add(1, 'minute').format('YYYY-MM-DD HH:mm:ss'),
  };
}