import { Configuration, OpenAIApi } from "openai";

export function getOpenAiApi(): OpenAIApi {
  const config = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  return new OpenAIApi(config);
}
