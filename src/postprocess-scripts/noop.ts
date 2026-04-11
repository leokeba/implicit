export function transform(context: any) {
    return {
        points: context.points,
        notes: ['No-op postprocess'],
    };
}