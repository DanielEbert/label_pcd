// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

import * as BABYLON from '@babylonjs/core';

interface MeshMetadata {
	builder: Polygon;
	type: 'node' | 'edge';
	index?: number; // index in nodePositions and node array for nodes
	pointsIndex?: [number, number]; // indices of the two nodes for edges
    _dragBehavior?: PointerDragBehavior; // Store reference to drag behavior
    _originalMaterial?: Material; // Store original material when highlighting
}

declare module '@babylonjs/core' {
	export interface Mesh {
		_highlightMat?: StandardMaterial; // Store the highlight material
		metadata?: MeshMetadata; // Custom metadata structure
	}
}

export {};
