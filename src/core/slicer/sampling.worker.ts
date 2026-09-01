/// <reference lib="webworker" />
/**
 * Dedicated worker for contour sampling: GPU SDF evaluation, marching
 * squares, contour selection, resampling, and alignment all run here so the
 * main thread stays responsive. The main thread composes the scene's shader
 * sources and sends them with each job; the worker never touches the live
 * scene registry.
 */
import { Slicer, type SliceProgressUpdate, type VaseSlicerSettings } from '../slicer';
import type { SceneControlDefinition, SceneControlValueMap } from '../shader-pipeline';

interface SampleRequest {
    type: 'sample';
    jobId: number;
    settings: Partial<VaseSlicerSettings>;
    vertexSource: string;
    fragmentSource: string;
    signature: string;
    pointVertexSource: string;
    pointFragmentSource: string;
    pointSignature: string;
    controlDefinitions: SceneControlDefinition[];
    controlValues: SceneControlValueMap;
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const slicer = new Slicer();

workerScope.onmessage = async (event: MessageEvent<SampleRequest>) => {
    const message = event.data;
    if (!message || message.type !== 'sample') {
        return;
    }

    try {
        slicer.setSlicerProgramSourcesOverride(message.vertexSource, message.fragmentSource, message.signature);
        slicer.setScenePointSamplerSourcesOverride(message.pointVertexSource, message.pointFragmentSource, message.pointSignature);
        slicer.setSceneControlState(message.controlDefinitions, message.controlValues);
        const result = await slicer.sampleContoursForWorker(message.settings, (update: SliceProgressUpdate) => {
            workerScope.postMessage({ type: 'progress', jobId: message.jobId, update });
        });
        workerScope.postMessage({
            type: 'done',
            jobId: message.jobId,
            layers: result.layers,
            warnings: result.warnings,
            pointsPerLayer: result.pointsPerLayer,
        });
    } catch (error) {
        workerScope.postMessage({
            type: 'error',
            jobId: message.jobId,
            message: error instanceof Error ? error.message : String(error),
            debugSnapshot: slicer.getLastSliceDebugSnapshot(),
        });
    }
};
