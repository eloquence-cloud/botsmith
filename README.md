# BotSmith README

## Overview

BotSmith is a TypeScript library designed for managing LLM conversations — `Chat`s. Currently it only supports OpenAI's GPT models. BotSmith facilitates generating `Completion`s and streaming assistant `Message`'s back to the user. BotSmith is comparable to OpenAI's Assistant API, but provides a more 
flexible `Chat` abstraction to support LLM-based application development.

BotSmith uses Supabase for persistence.

## Persistent Entities

- **Chat**: Represents a conversation as a tree structure of `Message` objects. The tree structure
supports branching such as for subtasks, user editing of a prior message, and testing new code against an existing chat.

- **Message**: can originate from the user or from application code, or can be generated by the assistant. Assistant-generated messages link back to their originating `Completion`.

- **Completion**: Records the point in a `Chat` where the LLM was invoked for a completion. Records all parameters passed to the LLM. Serves as a traceable link from this content to messages generated
during the completion process.

### The `Chat` Object

- `chatId`: A unique identifier for the chat.
- `headMessage`: The root message of the main conversation thread.
- `metadata`: A JSON object for storing additional, arbitrary data related to the chat.
- `defaultModelProvider`: an enum, presently always `OpenAi`
- `defaultModel`: name of the LLM

### The `Message` Object

- `messageId`: A unique identifier for the message.
- `chat`: The parent chat object.
- `branchBaseMessage`: The message that initiated this branch within the chat.
- `originatingCompletion`: The `Completion` that led to this message's creation, if applicable.
- `metadata`: A JSON object for storing additional, arbitrary data related to the message.

### The `Completion` Object

- `completionId`: A unique identifier for the completion.
- `chat`: A reference to the parent chat object.
- `contextMessages`: An array of `Message` objects that are not part of the chat, but are added to the chat for submission to GPT.
- `modelProvider`: an enum, presently always `OpenAi`
- `model`: name of the LLM
- `otherParameters`: Additional parameters passed to the model.

## Non-Persistent Types

- **GptFunction**: Represents a callable function within the GPT context, allowing for dynamic interactions and operations within a chat session.

## BotSmith Responsibilities

BotSmith is responsible for:
- Managing persistent entities (Chat, Message, Completion).
- Overseeing the chat flow, including:
  - Invoking OpenAI's API.
  - Streaming completion results to the client.
  - Dispatching GPT function calls.
  - Persisting both assistant-generated messages and function call results.
- Integrating with LangFuse for enhanced chat flow tracking and analytics.

## Getting Started

To begin using BotSmith, first install the package and configure your OpenAI API key. You can then create `Chat` sessions and integrate AI-powered responses into your applications.

```
npm install botsmith
```

Here's a simple example of BotSmith use. It assumes you have defined the following environment variables:
- `OPENAI_API_KEY`
- `SUPABASE_DB_URL`
- `SUPABASE_KEY`

```typescript
import { BotSmithClient, GptFunction, FunctionContext } from 'botsmith';

class FetchWeatherData extends GptFunction {
  constructor() {
    super(
      'Fetch weather data for a specified location and time',
      {
        where: { type: 'string' },
        when: { type: 'string' }
      }
    );
  }

  async do(context: FunctionContext, args: { where: string; when: string }): Promise<any> {
    console.log(`Fetching weather data for ${args.where} on ${args.when}...`);
    // Placeholder for actual fetch implementation
    return Promise.resolve({ temperature: '72°F', condition: 'Sunny' });
  }
}

const functions = [
  new FetchWeatherData()
];

const botsmith = new BotSmithClient({ 
    openAiAPiKey: process.env.OPENAI_API_KEY,
    supabaseDbUrl: process.env.SUPABASE_DB_URL
});
const chat = await botsmith.createChat({defaultModel: 'gpt-4', defaultTemperature: 0 });

async function handleUserInput(userContent: string) {
    try {
        const messageStream = botsmith.complete({
            chat: chat,
            newMessages: [{ role: 'user', content: userContent }],
            functions: functions
        });

        // Iterate over stream of assistant messages generated by the model.
        for await (const contentStream of messageStream) {
            // Iterate over chunks of a single message's content.
            for await (const chunk of contentStream) {
                console.log('Received chunk:', chunk);
                if (chunk.delta?.content) {
                    // In a real application, we'd display the new content chunk in the UI.
                    console.log('Message Content:', chunk.delta.content);
                }
                if (chunk.delta?.finishReason) {
                    console.log('Message completed with reason:', chunk.delta.finishReason);
                }
            }
        }
    } catch (error) {
        console.error('Error during chat completion:', error);
    }
}

// Example usage
handleUserInput("How's the weather in Chicago today?");
```