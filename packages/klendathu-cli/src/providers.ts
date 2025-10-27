import type { LanguageModel } from 'ai';
import type { Config } from './config.js';

/**
 * Create a language model instance based on configuration
 */
export async function createModel(config: Config): Promise<LanguageModel> {
  const { provider, model, options = {} } = config;

  // Helper to ensure model is specified
  const requireModel = (providerName: string): string => {
    if (!model) {
      throw new Error(
        `${providerName} provider requires a model to be specified. ` +
        `Set KLENDATHU_MODEL or add "model" to .klendathu.json`
      );
    }
    return model;
  };

  switch (provider) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const anthropic = createAnthropic(options);
      return anthropic(requireModel('Anthropic'));
    }

    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const openai = createOpenAI(options);
      return openai(requireModel('OpenAI'));
    }

    case 'azure': {
      const { createAzure } = await import('@ai-sdk/azure');
      const azure = createAzure(options);
      return azure(requireModel('Azure'));
    }

    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const google = createGoogleGenerativeAI(options);
      return google(requireModel('Google'));
    }

    case 'google-vertex': {
      const { createVertex } = await import('@ai-sdk/google-vertex');
      const vertex = createVertex(options);
      return vertex(requireModel('Google Vertex'));
    }

    case 'mistral': {
      const { createMistral } = await import('@ai-sdk/mistral');
      const mistral = createMistral(options);
      return mistral(requireModel('Mistral'));
    }

    case 'groq': {
      const { createGroq } = await import('@ai-sdk/groq');
      const groq = createGroq(options);
      return groq(requireModel('Groq'));
    }

    case 'amazon-bedrock': {
      const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock');
      const bedrock = createAmazonBedrock(options);
      return bedrock(requireModel('Amazon Bedrock'));
    }

    case 'cohere': {
      const { createCohere } = await import('@ai-sdk/cohere');
      const cohere = createCohere(options);
      return cohere(requireModel('Cohere'));
    }

    case 'xai': {
      const { createXai } = await import('@ai-sdk/xai');
      const xai = createXai(options);
      return xai(requireModel('xAI'));
    }

    case 'claude-code': {
      const { claudeCode } = await import('ai-sdk-provider-claude-code');
      // Claude Code has only 'sonnet' and 'opus' - default to sonnet if not specified
      const modelId = (model || 'sonnet') as 'sonnet' | 'opus';
      return claudeCode(modelId, options);
    }

    default:
      throw new Error(
        `Unknown provider: ${provider}. Supported providers: anthropic, openai, azure, google, google-vertex, mistral, groq, amazon-bedrock, cohere, xai, claude-code`
      );
  }
}

