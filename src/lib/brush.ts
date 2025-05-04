import * as BABYLON from '@babylonjs/core';
import { PointCloudManager } from './pointcloud';
import { CameraContainer } from './camera';
import { clamp } from './util';
import { PolygonManager } from './polygon_manager';
import { SimState, DrawMode } from './state.svelte';
import { paintColor } from './config';

export class BrushManager {
	public isPainting = false;

	private brushRadius = 0.2;
	private minBrushSize = 0.01;
	private maxBrushSize = 10;
	private lastPaintRay: BABYLON.Ray | null = null;

	private highlightColor = new BABYLON.Color4(235 / 255, 137 / 255, 52 / 255, 1); // white

	// Stores the indices of particles highlighted in the *previous* frame update.
	public highlightedIndicesLastFrame = new Set<number>();

	constructor(
		private pointCloudManager: PointCloudManager,
		private polygonManager: PolygonManager,
		private scene: BABYLON.Scene,
		private cameraContainer: CameraContainer,
		private simState: SimState
	) {}

	public adjustBrushSize(delta: number) {
		this.brushRadius = clamp(this.brushRadius - delta / 500, this.minBrushSize, this.maxBrushSize);
	}

	private getBaseColor(particleIndex: number): BABYLON.Color4 {
		const particle = this.pointCloudManager.pcs!.particles[particleIndex];
		if (this.pointCloudManager.pcsClass && this.pointCloudManager.pcsClass[particleIndex] === 1) {
			return paintColor;
		} else {
			return this.pointCloudManager.getParticleInitColor(particleIndex);
		}
	}

	private restoreParticlesToBaseColor(indices: Iterable<number>) {
		for (const i of indices) {
			this.pointCloudManager.setParticleColor(i, this.getBaseColor(i));
		}
	}

	public startPainting(): void {
		this.restoreParticlesToBaseColor(this.highlightedIndicesLastFrame);
		this.highlightedIndicesLastFrame.clear();
		this.isPainting = true;
	}

	public stopPainting(): void {
		this.isPainting = false;
		this.lastPaintRay = null;
	}

	public updateCursor(cursorX: number, cursorY: number) {
		const ray = this.scene.createPickingRay(
			cursorX,
			cursorY,
			BABYLON.Matrix.Identity(),
			this.cameraContainer.activeControlCamera,
			false
		);
		ray.direction.normalize();

		const rayLength = 40;

		if (this.simState.drawMode == DrawMode.Poly) {
			this.handleHighlighting(ray, rayLength);
			return;
		}

		if (this.isPainting) {
			this.handlePainting(ray, rayLength);
		} else {
			this.handleHighlighting(ray, rayLength);
		}
	}

	private handlePainting(ray: BABYLON.Ray, rayLength: number) {
		if (this.highlightedIndicesLastFrame.size > 0) {
			this.restoreParticlesToBaseColor(this.highlightedIndicesLastFrame);
			this.highlightedIndicesLastFrame.clear();
		}

		let particleIdxsToPaint = [];
		if (this.lastPaintRay == null) {
			particleIdxsToPaint = this.pointCloudManager.pcsLookup!.findParticlesNearRay(
				ray,
				rayLength,
				this.brushRadius,
				this.pointCloudManager.pcs!.particles
			);
		} else {
			const a = ray.origin;
			const b = ray.origin.add(ray.direction.normalize().scale(rayLength));
			const c = this.lastPaintRay.origin;
			const d = this.lastPaintRay.origin.add(
				this.lastPaintRay.direction.normalize().scale(rayLength)
			);
			particleIdxsToPaint = this.pointCloudManager.pcsLookup!.findParticlesNearRectangle(
				a,
				b,
				c,
				d,
				this.brushRadius,
				this.pointCloudManager.pcs!.particles
			);
		}
		this.lastPaintRay = ray;

		particleIdxsToPaint!.forEach((i) => {
			const particle = this.pointCloudManager.pcs!.particles[i];
			const targetColor =
				this.simState.drawMode === DrawMode.Draw
					? paintColor
					: this.pointCloudManager.getParticleInitColor(i);
			const classValue = this.simState.drawMode === DrawMode.Draw ? 1 : 0;

			if (
				!particle.color ||
				particle.color.r !== targetColor.r ||
				particle.color.g !== targetColor.g ||
				particle.color.b !== targetColor.b ||
				particle.color.a !== targetColor.a
			) {
				this.pointCloudManager.setParticleColor(i, targetColor);
				this.pointCloudManager.pcsClass![i] = classValue;
			}
		});
	}

	private handleHighlighting(ray: BABYLON.Ray, rayLength: number) {
		if (this.cameraContainer.activeControlCamera!.name === 'orbitCamera') {
			// can't be used currently because too slow with spatial hashing datastructure
			return;
		}

		const nearCursorIdxs = this.pointCloudManager.pcsLookup!.findParticlesNearRay(
			ray,
			rayLength,
			this.brushRadius,
			this.pointCloudManager.pcs!.particles
		);

		let inPolygonIdxs: number[] = [];
		this.polygonManager.polygons?.forEach((poly) => {
			const particlesInPolygon = this.pointCloudManager.pcsLookup!.findParticlesInPolygon(
				poly.nodePositions,
				this.pointCloudManager.pcs!.particles
			);

			inPolygonIdxs.push(...particlesInPolygon);
		});

		const highlightIdxsThisFrame = new Set([...nearCursorIdxs, ...inPolygonIdxs]);

		const indicesToRestore = new Set<number>();
		this.highlightedIndicesLastFrame.forEach((i) => {
			if (!highlightIdxsThisFrame.has(i)) {
				indicesToRestore.add(i);
			}
		});

		this.restoreParticlesToBaseColor(indicesToRestore);

		highlightIdxsThisFrame.forEach((i) => {
			this.pointCloudManager.setParticleColor(i, this.highlightColor);
		});

		this.highlightedIndicesLastFrame = highlightIdxsThisFrame;
	}
}
