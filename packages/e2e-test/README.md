# E2E Tests

End-to-end tests for klendathu that use real AI providers.

## Running Tests

### Default (Claude Code)
```bash
pnpm test
```
Requires: `claude login`

### OpenAI
```bash
export OPENAI_API_KEY=sk-...
export KLENDATHU_MODEL=gpt-4o
pnpm test:openai
```

### Anthropic
```bash
export ANTHROPIC_API_KEY=sk-...
export KLENDATHU_MODEL=claude-3-5-sonnet-20241022
pnpm test:anthropic
```

### Google
```bash
export GOOGLE_GENERATIVE_AI_API_KEY=...
export KLENDATHU_MODEL=gemini-1.5-pro
pnpm test:google
```

### Amazon Bedrock
```bash
# Ensure AWS credentials are configured
export KLENDATHU_MODEL=anthropic.claude-3-sonnet-20240229-v1:0
pnpm test:bedrock
```

## Notes

- All tests use the same test file (`src/debugger.test.ts`)
- Provider/model configuration is via environment variables
- Each provider requires appropriate API keys and model names
- Refer to each provider's documentation for current model names
