import { google } from 'googleapis';
import * as fs from 'fs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TOKEN_PATH = './token.json';
const CREDENTIALS_PATH = './client_secret_379904458391-idc5lh136jsl4804fu58cmbjlfvel375.apps.googleusercontent.com.json';

let oAuth2Client: any = null;
let drive: any = null;

async function getOAuthClient() {
  if (oAuth2Client) {
    // Check if token needs refresh (happens automatically with the library)
    return oAuth2Client;
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

  oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Load the saved token
  try {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);

    // Set up automatic token refresh
    oAuth2Client.on('tokens', (tokens: any) => {
      if (tokens.refresh_token) {
        // Store the new refresh token if we got one
        const currentToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        const updatedToken = { ...currentToken, ...tokens };
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedToken));
        console.log('Token refreshed and saved');
      }
    });

    console.log('OAuth client initialized with existing token');
  } catch (err) {
    throw new Error('No OAuth token found. Please run setup-oauth-drive.ts first');
  }

  return oAuth2Client;
}

function getDriveClient() {
  if (!drive) {
    throw new Error('Drive client not initialized. Call initializeDrive() first');
  }
  return drive;
}

export async function initializeDrive() {
  const auth = await getOAuthClient();
  drive = google.drive({ version: 'v3', auth });
  console.log('Drive client initialized with OAuth');
  return drive;
}

export async function uploadPhoto(
  photoBuffer: Buffer,
  filename: string,
  parentFolderId?: string
): Promise<string> {
  const driveClient = getDriveClient();
  const DRIVE_FOLDER_ID = parentFolderId || process.env.DRIVE_FOLDER_ID;

  if (!DRIVE_FOLDER_ID) {
    throw new Error('DRIVE_FOLDER_ID environment variable is required');
  }

  // Check if attachments folder exists, create if not
  const attachmentsFolderId = await getOrCreateAttachmentsFolder(DRIVE_FOLDER_ID);

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
  } catch (error: any) {
    if (error.code === 401) {
      console.error('OAuth token expired. Please run: bun setup-oauth-drive.ts');
      throw new Error('Google Drive authentication expired. Please re-authenticate.');
    }
    console.error('Failed to upload photo to Drive:', error);
    throw error;
  }
}

async function getOrCreateAttachmentsFolder(parentFolderId: string): Promise<string> {
  const driveClient = getDriveClient();

  try {
    // Check if attachments folder exists
    const searchResponse = await driveClient.files.list({
      q: `name='attachments' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id;
    }

    // Create attachments folder
    const folderMetadata = {
      name: 'attachments',
      parents: [parentFolderId],
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
  } catch (error: any) {
    if (error.code === 401) {
      console.error('OAuth token expired. Please run: bun setup-oauth-drive.ts');
      throw new Error('Google Drive authentication expired. Please re-authenticate.');
    }
    console.error('Failed to append to daily file:', error);
    throw error;
  }
}

async function getOrCreateDailyFile(filename: string, parentFolderId: string): Promise<string> {
  const driveClient = getDriveClient();

  try {
    // Check if file exists
    const searchResponse = await driveClient.files.list({
      q: `name='${filename}' and '${parentFolderId}' in parents`,
      fields: 'files(id, name)',
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id;
    }

    // Create new file
    const fileMetadata = {
      name: filename,
      parents: [parentFolderId],
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