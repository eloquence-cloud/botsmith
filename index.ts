import {
  ChatCompletionFunctions,
  ChatCompletionRequestMessage,
  ChatCompletionRequestMessageRoleEnum,
  ChatCompletionResponseMessage,
  CreateChatCompletionRequest,
  CreateChatCompletionResponse,
} from "openai";
import { AxiosResponse } from "axios";
import { getOpenAiApi } from "./openai";

const MAX_RETRIES: number = 5;

export type ChatMessage = ChatCompletionRequestMessage;
export type ChatHistory = ChatMessage[];
export const ChatRole = ChatCompletionRequestMessageRoleEnum;
export type ChatRole = ChatCompletionRequestMessageRoleEnum;

export function chatMessageDebugOneLine(message: ChatMessage): string {
  const role = message.role;
  const content = message.content
    ? message.content.slice(0, 50) + (message.content.length > 50 ? "..." : "")
    : "";
  const name = message.name ? message.name : "";
  const functionCall = message.function_call
    ? `${message.function_call.name}(${message.function_call.arguments})`
    : "";

  return `${role} ${name}: ${content} ${functionCall}`;
}

export function chatHistoryDebugConcise(history: ChatHistory): string {
  return history.map((m) => chatMessageDebugOneLine(m) + "\n").join("");
}

export function chatHistoryDebugVeryConcise(history: ChatHistory): string {
  const numMessages = history.length;
  const penultimateMessage =
    numMessages > 1 ? chatMessageDebugOneLine(history[numMessages - 2]) : "n/a";
  const lastMessage =
    numMessages > 0 ? chatMessageDebugOneLine(history[numMessages - 1]) : "n/a";

  return `Number of messages: ${numMessages}\n[n-2]: ${penultimateMessage}\n[n-1]: ${lastMessage}\n`;
}

function extendAndThrowOpenAIError(error: any, openaiRequest: any): never {
  let message = error.message === undefined ? "unknown error" : error.message;
  if (error.isAxiosError && error.response !== undefined) {
    message += ": " + JSON.stringify(error.response.data.error);
  }
  if (openaiRequest) {
    message += "\nHere was the request:\n" + JSON.stringify(openaiRequest);
  }
  throw new Error("error calling OpenAI: " + message);
}

/**
 * Treat a chat model as a completion model, returning a completion for the given prompt.
 *
 * @param prompt instructions that will be provided as a user message
 * @param model optionally overrides the default from configs/openai.ts
 * @returns a promise of a completion message
 */
export async function getCompletionUsingChatModel(
  systemMessage: string,
  prompt: string,
  model: string,
  temperature: number
): Promise<ChatMessage> {
  const promptMessages: ChatHistory = [
    {
      role: "system",
      content: systemMessage,
    },
    {
      role: "user",
      content: prompt,
    },
  ];
  let openaiRequest: CreateChatCompletionRequest = {
    model: model,
    temperature: temperature,
    messages: promptMessages,
  };
  let response;
  try {
    response = await getOpenAiApi().createChatCompletion(openaiRequest);
  } catch (error: any) {
    extendAndThrowOpenAIError(error, openaiRequest);
  }
  let responseData = validateCreateChatCompletionResponse(
    response as AxiosResponse
  );
  let message = {
    role: ChatRole.Assistant,
    content: responseData.choices[0].message.content || "",
  };
  console.log(
    `==== getCompletionUsingChatModel prompt:\n${chatHistoryDebugConcise(
      promptMessages
    )}` +
      `==== completion:\n${JSON.stringify(
        responseData.choices[0],
        null,
        2
      )}\n` +
      `==== returning:\n${JSON.stringify(message, null, 2)}\n` +
      `====`
  );
  return message;
}

function validateCreateChatCompletionResponse(
  response: AxiosResponse<CreateChatCompletionResponse, any>
): any {
  if (response) {
    return response;
  } else {
    throw new Error(
      `OpenAI response data validation error: 
        ========
        response.data:
        
        ${JSON.stringify(response, null, 2)}
        `
    );
  }
}

export async function getFunctionResult(
  messages: ChatCompletionRequestMessage[],
  model: string = "gpt-4",
  functions: any[]
) {
  let openaiRequest: CreateChatCompletionRequest = {
    model: model,
    messages: messages,
    functions: functions,
    temperature: 0,
  };
  let response = await getOpenAiApi().createChatCompletion(openaiRequest);
  return response.data.choices;
}

export async function retryOnOpenAiError(
  func: CallableFunction,
  ...args: any
): Promise<ChatMessage> {
  let retries: number = 0;
  let err: Error = new Error();

  while (retries < MAX_RETRIES) {
    try {
      return func(...args);
    } catch (error) {
      console.log(error);
      err = error as Error;
      retries = retries + 1;
    }
  }
  let errorMessage = `Giving up after ${retries}.\nfunc=${func}\nargs=${args}\nerror=${err.message}`;
  throw new Error(errorMessage);
}

export abstract class GptFunction {
  get name(): string {
    return this.constructor.name;
  }

  description: string;

  /** JSON schema for the parameters */
  parameters: { [key: string]: any };

  /** If true, this GptFunction has no implementation and must be interpreted by surrounding code. */
  isNoOp: boolean;

  private ajvValidateFunction: any;

  constructor(
    description: string,
    parameters: { [key: string]: any },
    isNoOp: boolean = false
  ) {
    this.description = description;
    this.parameters = parameters;
    this.isNoOp = isNoOp;
  }

  validate(args: any) {
    const valid = this.ajvValidateFunction(args);
    if (!valid) {
      return {
        type: "FunctionCallInvalid",
        errorMessage: `invalid arguments for function ${this.name}:`,
      };
    }
  }

  abstract do(chatState: any, args: Record<string, unknown>): Promise<any>;
}

export type FunctionCallInvalid = {
  type: "FunctionCallInvalid";
  errorMessage: string;
};

export type FunctionSucceeded = {
  type: "FunctionSucceeded";
  result: any;
};

export type FunctionThrew = {
  type: "FunctionThrew";
  error: Error;
};

// The result of dispatch can be one of the three types
export type DispatchResult =
  | FunctionCallInvalid
  | FunctionSucceeded
  | FunctionThrew;

export class GptFunctionsConfig {
  private functions: GptFunction[];

  constructor(functions: GptFunction[]) {
    this.functions = functions;
  }

  getFunctions(): GptFunction[] {
    return [...this.functions];
  }

  formatForGpt(enabledFunctionNames: Set<string>): ChatCompletionFunctions[] {
    return this.functions.map((func) => {
      const isEnabled = enabledFunctionNames.has(func.name);
      return {
        name: func.name,
        description: isEnabled
          ? func.description
          : `DEPRECATED: ${func.description}`,
        parameters: func.parameters,
      };
    });
  }

  async dispatch(chatState: any): Promise<DispatchResult> {
    const chatHistory = chatState.chatHistory;
    const assistantMessage = chatHistory[chatHistory.length - 1];

    const functionName = assistantMessage.function_call.name;
    const argumentsString = assistantMessage.function_call.arguments || "{}";
    const func = this.functions.find((f) => f.name === functionName);
    if (!func) {
      return {
        type: "FunctionCallInvalid",
        errorMessage: `unknown function ${functionName}`,
      };
    }

    let args;
    try {
      args = JSON.parse(argumentsString);
    } catch (error) {
      return {
        type: "FunctionCallInvalid",
        errorMessage: `invalid JSON string for arguments: ${argumentsString}`,
      };
    }

    const validationErrorMessage = func.validate(args);
    if (validationErrorMessage) {
      return {
        type: "FunctionCallInvalid",
        errorMessage: `invalid arguments for function ${functionName}: ${validationErrorMessage}`,
      };
    }

    if (func.isNoOp) {
      return {
        type: "FunctionSucceeded",
        result: null,
      };
    }

    try {
      const result = await Promise.resolve(func.do(chatState, args));
      return {
        type: "FunctionSucceeded",
        result,
      };
    } catch (error) {
      console.error(`GPT function ${functionName} threw`, error);
      return {
        type: "FunctionThrew",
        error:
          error instanceof Error ? error : new Error(JSON.stringify(error)),
      };
    }
  }
}

function approximateMaxChars(model: string): number {
  switch (model) {
    case "gpt-4":
      return 8000 * 4;
    default:
      throw Error("unknown model: " + model);
  }
}

const FRACTION_OF_MAX_CHARS_TO_USE = 0.8;

/**
 * Get a chat completion from OpenAI.
 *
 * @param messages array of messages to be sent to OpenAI. The system message will be prepended to this array.
 *                 If necessary for space reasons, messages may be dropped from the front of this array.
 * @param model model name
 * @param temperature
 * @returns a promise of a chat completion response message
 * @throws error if the OpenAI response does not match the defined schema or if the response message is not defined
 */
export async function getChatCompletion(
  messages: ChatCompletionRequestMessage[],
  systemMessageContent: string,
  model: string,
  temperature: number,
  functions: ChatCompletionFunctions[] | null = null
): Promise<ChatCompletionResponseMessage> {
  const systemMessage = {
    role: ChatRole.System,
    content: systemMessageContent,
  };

  // Possibly drop messages from the front of the array.
  const maxChars = approximateMaxChars(model) * FRACTION_OF_MAX_CHARS_TO_USE;
  const baseChars =
    JSON.stringify(systemMessage).length + JSON.stringify(functions).length;
  let startingMessageIndex = messages.length - 1;
  let totalChars =
    baseChars + JSON.stringify(messages[startingMessageIndex]).length;
  console.log(
    `getChatCompletion: baseChars=${baseChars}, totalChars=${totalChars}, maxChars=${maxChars}`
  );
  while (
    startingMessageIndex > 0 &&
    totalChars + JSON.stringify(messages[startingMessageIndex - 1]).length <
      maxChars
  ) {
    startingMessageIndex--;
    totalChars += JSON.stringify(messages[startingMessageIndex]).length;
    console.log(
      `getChatCompletion: including message ${startingMessageIndex}; totalChars=${totalChars}`
    );
  }
  const promptMessages: ChatHistory = [
    systemMessage,
    ...messages.slice(startingMessageIndex),
  ];

  let openaiRequest: CreateChatCompletionRequest = {
    model: model,
    temperature: temperature,
    messages: promptMessages,
  };
  if (functions !== null) {
    openaiRequest.functions = functions;
  }
  let response;
  try {
    response = await getOpenAiApi().createChatCompletion(openaiRequest);
  } catch (error: any) {
    extendAndThrowOpenAIError(error, openaiRequest);
  }
  let responseData = validateCreateChatCompletionResponse(
    response as AxiosResponse
  );
  let responseMessage = responseData.choices[0].message;
  console.log(
    `==== getChatCompletion prompt:\n${chatHistoryDebugConcise(
      promptMessages
    )}` +
      `==== completion:\n${JSON.stringify(responseMessage, null, 2)}\n` +
      `====`
  );

  return {
    role: responseMessage.role,
    content: responseMessage.content || "",
    function_call: responseMessage.function_call,
  };
}
