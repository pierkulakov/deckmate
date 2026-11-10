import { defineText, serverText } from './i18n.ts';

const propertyText = defineText({
  owner: "Owner must be one line of up to 120 characters or null.",
  effort: "Card Effort must be a finite nonnegative number or null.",
  priority: "Card Priority must be high, medium, low or null.",
  bulkEffort: "Effort must be a finite nonnegative number or null.",
  bulkPriority: "Invalid Priority.",
  newCardEffort: "Card Effort must be a nonnegative number.",
  newCardPriority: "Card Priority must be high, medium or low.",
}, {
  owner: "Исполнитель — одна строка до 120 символов или null.",
  effort: "Цена карточки — конечное число не меньше нуля или null.",
  priority: "Приоритет карточки — high, medium, low или null.",
  bulkEffort: "Оценка — конечное число не меньше нуля или null.",
  bulkPriority: "Недопустимый приоритет.",
  newCardEffort: "Цена карточки — число не меньше нуля.",
  newCardPriority: "Приоритет карточки — high, medium или low.",
});

type PropertyContext = 'single' | 'bulk' | 'create';

export function validateOwner(owner: unknown): asserts owner is string | null {
  if (owner !== null && (typeof owner !== 'string' || !owner.trim() || owner.length > 120 || /[\r\n\u0000]/u.test(owner))) throw new Error(serverText(propertyText).owner);
}

export function validateEffort(effort: unknown, context: PropertyContext = 'single'): asserts effort is number | null {
  if (effort !== null && (typeof effort !== 'number' || !Number.isFinite(effort) || effort < 0)) {
    const text = serverText(propertyText);
    const message = { single: text.effort, bulk: text.bulkEffort, create: text.newCardEffort }[context];
    throw new Error(message);
  }
}

export function validatePriority(priority: unknown, context: PropertyContext = 'single'): asserts priority is 'high' | 'medium' | 'low' | null {
  if (priority !== null && !['high', 'medium', 'low'].includes(priority as string)) {
    const text = serverText(propertyText);
    const message = { single: text.priority, bulk: text.bulkPriority, create: text.newCardPriority }[context];
    throw new Error(message);
  }
}
