import { google } from 'googleapis';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

let drive: any = null;

function getDriveClient() {
  if (!drive) {
    const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is required');
    }

    let credentials;
    try {
      // Try to parse as JSON first
      credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      // If that fails, try base64 decode then parse
      const decoded = Buffer.from(GOOGLE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf-8');
      credentials = JSON.parse(decoded);
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    drive = google.drive({ version: 'v3', auth });
  }

  return drive;
}

export async function uploadPhoto(
  photoBuffer: Buffer,
  filename: string,
  parentFolderId?: string
): Promise<string> {
  const driveClient = getDriveClient();
  const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

  if (!DRIVE_FOLDER_ID && !parentFolderId) {
    throw new Error('DRIVE_FOLDER_ID environment variable is required');
  }

  // Check if attachments folder exists, create if not
  const attachmentsFolderId = await getOrCreateAttachmentsFolder(parentFolderId || DRIVE_FOLDER_ID!);

  const fileMetadata = {
    name: filename,
    parents: [attachmentsFolderId],
  };

  const media = {
    mimeType: 'image/jpeg',
    body: Buffer.from(photoBuffer),
  };

  try {
    const response = await driveClient.files.create({
      requestBody: fileMetadata,
      media: media,
    });

    return response.data.id;
  } catch (error) {
    console.error('Failed to upload photo to Drive:', error);
    throw error;
  }
}

async function getOrCreateAttachmentsFolder(parentFolderId: string): Promise<string> {
  const driveClient = getDriveClient();

  try {
    // Validate the parent folder first
    const validatedFolderId = await validateAndGetFolderId(parentFolderId);

    // Check if attachments folder exists
    const searchResponse = await driveClient.files.list({
      q: `name='attachments' and '${validatedFolderId}' in parents and mimeType='application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id;
    }

    // Create attachments folder
    const folderMetadata = {
      name: 'attachments',
      parents: [validatedFolderId],
      mimeType: 'application/vnd.google-apps.folder',
    };

    const folderResponse = await driveClient.files.create({
      requestBody: folderMetadata,
    });

    return folderResponse.data.id;
  } catch (error) {
    console.error('Failed to get/create attachments folder:', error);
    throw error;
  }
}

export async function appendToDaily(
  date: string,
  content: string,
  userTimezone: string = 'America/Los_Angeles'
): Promise<void> {
  const driveClient = getDriveClient();
  const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

  if (!DRIVE_FOLDER_ID) {
    throw new Error('DRIVE_FOLDER_ID environment variable is required');
  }

  const filename = `${date}.md`;
  const fileId = await getOrCreateDailyFile(filename, DRIVE_FOLDER_ID);

  try {
    // Get current file content
    const response = await driveClient.files.get({
      fileId: fileId,
      alt: 'media',
    });

    const currentContent = response.data || '';
    const timestamp = dayjs().tz(userTimezone).format('HH:mm');
    const newLine = `- [${timestamp}] ${content}`;
    const updatedContent = currentContent.trim() + (currentContent.trim() ? '\n' : '') + newLine + '\n';

    // Update file content
    await driveClient.files.update({
      fileId: fileId,
      media: {
        mimeType: 'text/markdown',
        body: updatedContent,
      },
    });

    console.log(`Appended to daily file ${filename}: ${newLine}`);
  } catch (error) {
    console.error('Failed to append to daily file:', error);
    throw error;
  }
}

async function validateAndGetFolderId(folderId: string): Promise<string> {
  const driveClient = getDriveClient();

  try {
    // First check if the folder exists and we have access
    await driveClient.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType',
    });
    return folderId;
  } catch (error: any) {
    if (error.code === 404) {
      console.warn(`Drive folder ${folderId} not found. Creating new root folder...`);
      // Create a new root folder for the bot
      const folderMetadata = {
        name: 'Personal Historian Bot',
        mimeType: 'application/vnd.google-apps.folder',
      };

      const folderResponse = await driveClient.files.create({
        requestBody: folderMetadata,
      });

      const newFolderId = folderResponse.data.id;
      console.log(`Created new root folder with ID: ${newFolderId}`);
      console.log(`Please update your DRIVE_FOLDER_ID environment variable to: ${newFolderId}`);
      return newFolderId;
    }
    throw error;
  }
}

async function getOrCreateDailyFile(filename: string, parentFolderId: string): Promise<string> {
  const driveClient = getDriveClient();

  try {
    // Validate the parent folder first
    const validatedFolderId = await validateAndGetFolderId(parentFolderId);

    // Check if file exists
    const searchResponse = await driveClient.files.list({
      q: `name='${filename}' and '${validatedFolderId}' in parents`,
      fields: 'files(id, name)',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id;
    }

    // Create new file
    const fileMetadata = {
      name: filename,
      parents: [validatedFolderId],
    };

    const media = {
      mimeType: 'text/markdown',
      body: `# ${filename.replace('.md', '')}\n\n`,
    };

    const fileResponse = await driveClient.files.create({
      requestBody: fileMetadata,
      media: media,
    });

    console.log(`Created new daily file: ${filename}`);
    return fileResponse.data.id;
  } catch (error) {
    console.error('Failed to get/create daily file:', error);
    throw error;
  }
}

export function generatePhotoMarkdown(filename: string, caption?: string): string {
  const description = caption || 'Photo';
  return `![${description}](./attachments/${filename})`;
}