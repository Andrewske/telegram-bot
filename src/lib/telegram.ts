export async function sendMessage(
  chatId: string | number,
  text: string,
  botToken?: string
): Promise<void> {
  const BOT_TOKEN = botToken || process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN environment variable is required');
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Telegram API error: ${response.status} - ${errorData}`);
    }

    console.log(`Message sent to ${chatId}: ${text.slice(0, 50)}...`);
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    throw error;
  }
}

export async function downloadPhoto(
  fileId: string,
  botToken?: string
): Promise<Buffer> {
  const BOT_TOKEN = botToken || process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN environment variable is required');
  }

  try {
    // Get file path from Telegram API
    const fileInfoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile`;
    const fileInfoResponse = await fetch(fileInfoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_id: fileId,
      }),
    });

    if (!fileInfoResponse.ok) {
      throw new Error(`Failed to get file info: ${fileInfoResponse.status}`);
    }

    const fileInfo = await fileInfoResponse.json();
    const filePath = fileInfo.result.file_path;

    // Download the actual file
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const fileResponse = await fetch(fileUrl);

    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.status}`);
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Failed to download photo from Telegram:', error);
    throw error;
  }
}

export function isAllowedUser(userId: number): boolean {
  const TELEGRAM_ALLOWED_USER_ID = process.env.TELEGRAM_ALLOWED_USER_ID;

  if (!TELEGRAM_ALLOWED_USER_ID) {
    console.warn('TELEGRAM_ALLOWED_USER_ID not set - allowing all users');
    return true;
  }

  return userId.toString() === TELEGRAM_ALLOWED_USER_ID;
}

export function generatePhotoFilename(userId: number, timestamp: Date): string {
  const dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = timestamp.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-'); // HH-MM-SS
  return `${dateStr}-${timeStr}-${userId}.jpg`;
}