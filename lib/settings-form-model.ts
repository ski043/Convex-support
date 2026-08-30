export function syncUntouchedValue<Value>(
  currentValue: Value,
  previousServerValue: Value,
  nextServerValue: Value,
) {
  return Object.is(currentValue, previousServerValue)
    ? nextServerValue
    : currentValue;
}

export function normalizeNonEmptyValues(values: string[]) {
  const normalized = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) normalized.add(trimmed);
  }
  return [...normalized].sort();
}

export function normalizedValuesEqual(left: string[], right: string[]) {
  const normalizedLeft = normalizeNonEmptyValues(left);
  const normalizedRight = normalizeNonEmptyValues(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

export function widgetOriginObservationWarnings(state: {
  isAtCapacity: boolean;
  isTruncated: boolean;
}) {
  return {
    showCapacity: state.isAtCapacity,
    showTruncation: state.isTruncated,
  };
}
