export interface NumericControlOption {
    value: number;
    label: string;
}

export function parseNumericControlOptions(rawOptions: unknown): NumericControlOption[] {
    if (!Array.isArray(rawOptions)) {
        return [];
    }

    const options: NumericControlOption[] = [];
    const seenValues = new Set<number>();
    let nextImplicitValue = 0;

    const allocateImplicitValue = (): number => {
        while (seenValues.has(nextImplicitValue)) {
            nextImplicitValue += 1;
        }

        const assigned = nextImplicitValue;
        seenValues.add(assigned);
        nextImplicitValue += 1;
        return assigned;
    };

    for (const candidate of rawOptions) {
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            if (!seenValues.has(candidate)) {
                seenValues.add(candidate);
                options.push({ value: candidate, label: String(candidate) });
            }
            continue;
        }

        if (typeof candidate === 'string') {
            const label = candidate.trim();
            if (!label) {
                continue;
            }

            options.push({ value: allocateImplicitValue(), label });
            continue;
        }

        if (!candidate || typeof candidate !== 'object') {
            continue;
        }

        const rawValue = readFiniteNumber((candidate as { value?: unknown }).value);
        const rawLabel = (candidate as { label?: unknown }).label;
        const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';

        if (rawValue !== null) {
            if (seenValues.has(rawValue)) {
                continue;
            }

            seenValues.add(rawValue);
            options.push({ value: rawValue, label: label || String(rawValue) });
            continue;
        }

        if (!label) {
            continue;
        }

        options.push({ value: allocateImplicitValue(), label });
    }

    return options;
}

export function inferOptionStep(options: Array<Pick<NumericControlOption, 'value'>>): number {
    if (options.length <= 1) {
        return 1;
    }

    const sortedValues = options
        .map((option) => option.value)
        .sort((left, right) => left - right);

    let smallestPositiveDelta = Number.POSITIVE_INFINITY;
    for (let index = 1; index < sortedValues.length; index++) {
        const delta = sortedValues[index] - sortedValues[index - 1];
        if (delta > 0 && delta < smallestPositiveDelta) {
            smallestPositiveDelta = delta;
        }
    }

    return Number.isFinite(smallestPositiveDelta) ? smallestPositiveDelta : 1;
}

export function snapToNearestOptionValue(value: number, options: Array<Pick<NumericControlOption, 'value'>>): number {
    if (options.length === 0) {
        return value;
    }

    let nearestValue = options[0].value;
    let nearestDistance = Math.abs(nearestValue - value);

    for (let index = 1; index < options.length; index++) {
        const candidateValue = options[index].value;
        const candidateDistance = Math.abs(candidateValue - value);
        if (candidateDistance < nearestDistance) {
            nearestValue = candidateValue;
            nearestDistance = candidateDistance;
        }
    }

    return nearestValue;
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}