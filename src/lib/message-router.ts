export interface MessageHandler {
  canHandle(message: string): boolean;
  handleMessage(
    message: string,
    userId: string,
    messageId: number,
    timezone: string,
    replyToMessageId?: number
  ): Promise<{
    response: string;
    shouldUpdateCheckin?: boolean;
  }>;
  handlePhoto?(
    photoBuffer: Buffer,
    caption: string,
    userId: string,
    messageId: number,
    timezone: string
  ): Promise<{
    response: string;
    shouldUpdateCheckin?: boolean;
  }>;
}

interface HandlerModule {
  handler: MessageHandler;
}

const handlers: MessageHandler[] = [];

export function registerHandler(handler: MessageHandler): void {
  handlers.push(handler);
}

export function routeMessage(
  message: string,
  userId: string,
  messageId: number,
  timezone: string,
  replyToMessageId?: number
): Promise<{ response: string; shouldUpdateCheckin?: boolean }> {
  // Find the first handler that can handle this message
  for (const handler of handlers) {
    if (handler.canHandle(message)) {
      return handler.handleMessage(message, userId, messageId, timezone, replyToMessageId);
    }
  }

  // No specialized handler found, this should be handled by the default life journal system
  throw new Error('NO_HANDLER_FOUND');
}

export function routePhoto(
  photoBuffer: Buffer,
  caption: string,
  userId: string,
  messageId: number,
  timezone: string
): Promise<{ response: string; shouldUpdateCheckin?: boolean }> {
  // Check if any handler wants to process this photo based on caption
  for (const handler of handlers) {
    if (handler.handlePhoto && handler.canHandle(caption)) {
      return handler.handlePhoto(photoBuffer, caption, userId, messageId, timezone);
    }
  }

  // No specialized handler found, this should be handled by the default life journal system
  throw new Error('NO_HANDLER_FOUND');
}

// Auto-register handlers
export async function initializeHandlers(): Promise<void> {
  try {
    // Import and register food handler
    const foodHandlerModule = await import('../handlers/food-handler.js') as HandlerModule;
    registerHandler(foodHandlerModule.handler);

    // Future handlers can be added here
    // const budgetHandlerModule = await import('../handlers/budget-handler.js') as HandlerModule;
    // registerHandler(budgetHandlerModule.handler);

    console.log(`Initialized ${handlers.length} message handlers`);
  } catch (error) {
    console.error('Failed to initialize handlers:', error);
  }
}