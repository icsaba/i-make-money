import OpenAI from 'openai';
import { TradingData, TradingPlan, TradingPlanValidation } from '../types/trading';
import { PromptFactory } from './PromptFactory';

export class OpenAIService {
  private client: OpenAI;

  constructor(project: string, apiKey: string) {
    this.client = new OpenAI({
      project,
      apiKey,
    });
  }

  async getTradingPlan(data: TradingData): Promise<TradingPlan> {
    try {
      const prompt = PromptFactory.createAnalysisPrompt(data);

      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: prompt
        }],
        max_tokens: 1000,
        temperature: 0.3
      });

      const content = response.choices[0].message.content;
      
      // Extract JSON from the response
      const jsonMatch = content?.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response');
      }

      const analysis = JSON.parse(jsonMatch[0]);
      return analysis.tradingPlan;

    } catch (error) {
      console.error('Error getting trading plan:', error);
      throw error;
    }
  }

  async validateTradingConditions(plan: TradingPlan, currentData: TradingData): Promise<TradingPlanValidation> {
    try {
      const prompt = PromptFactory.createValidationPrompt(plan, currentData);

      const response = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{
          role: "user",
          content: prompt
        }],
        max_tokens: 250,
        temperature: 0.2
      });

      const content = response.choices[0].message.content;
      
      // Extract JSON from the response
      const jsonMatch = content?.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response');
      }

      const validation = JSON.parse(jsonMatch[0]);
      return validation;

    } catch (error) {
      console.error('Error validating trading conditions:', error);
      throw error;
    }
  }
} 