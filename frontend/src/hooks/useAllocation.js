export function createEqualAllocation(features) {
  if (!features.length) return {};

  const base = Math.floor(100 / features.length);
  let remainder = 100 - base * features.length;

  return Object.fromEntries(
    features.map((feature) => {
      const value = base + (remainder > 0 ? 1 : 0);
      remainder -= remainder > 0 ? 1 : 0;

      return [feature.id, value];
    })
  );
}

export function distributeUntouched(state, activeFeatures) {
  const activeIds = new Set(activeFeatures.map((feature) => feature.id));

  const pinnedIds = new Set(
    [...state.pinnedIds].filter((featureId) => activeIds.has(featureId))
  );

  const values = Object.fromEntries(
    activeFeatures.map((feature) => [
      feature.id,
      Math.max(0, Number(state.values[feature.id]) || 0),
    ])
  );

  const pinnedTotal = [...pinnedIds].reduce(
    (sum, featureId) => sum + values[featureId],
    0
  );

  const untouched = activeFeatures.filter(
    (feature) => !pinnedIds.has(feature.id)
  );

  if (!untouched.length) {
    return { values, pinnedIds };
  }

  const available = Math.max(0, 100 - pinnedTotal);
  const base = Math.floor(available / untouched.length);
  let remainder = available - base * untouched.length;

  untouched.forEach((feature) => {
    values[feature.id] = base + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
  });

  return { values, pinnedIds };
}


export function useAllocation({
  activeFeatures,
  setAllocation,
  canSubmitPrioritization,
  submitting
}) {
  const updatePercentage = (featureId, rawValue) => {
    if (!canSubmitPrioritization || submitting) return;

    const numericValue = Array.isArray(rawValue)
      ? rawValue[0]
      : rawValue;

    setAllocation((current) => {
      const pinnedOtherTotal = activeFeatures.reduce((sum, feature) => {
        if (
          feature.id === featureId ||
          !current.pinnedIds.has(feature.id)
        ) {
          return sum;
        }

        return sum + Number(current.values[feature.id] || 0);
      }, 0);

      const maxValue = Math.max(0, 100 - pinnedOtherTotal);

      const value = Math.max(
        0,
        Math.min(maxValue, Number(numericValue) || 0)
      );

      const pinnedIds = new Set(current.pinnedIds);
      pinnedIds.add(featureId);

      return distributeUntouched(
        {
          values: { ...current.values, [featureId]: value },
          pinnedIds,
        },
        activeFeatures
      );
    });
  };


  return {
    updatePercentage
  };
}
