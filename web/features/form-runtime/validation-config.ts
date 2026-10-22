type ValidationProps = {
  isRequired?: boolean;
  isUnique?: boolean;
  formatValidation?: string;
  minValue?: number;
  maxValue?: number;
};

/** Loading and editing preserve each validation rule independently. */
export function normalizeValidationProps<T extends ValidationProps>(props: T): T {
  return props;
}

export function updateValidationProps<T extends ValidationProps>(current: T, patch: Partial<Omit<T, keyof ValidationProps>> & ValidationProps): T {
  return { ...current, ...patch };
}
