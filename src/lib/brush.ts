import * as BABYLON from '@babylonjs/core';
import { PointCloudManager } from './pointcloud';
import { CameraContainer } from './camera';
import { clamp } from './util';

export enum DrawMode {
    Draw = "DRAW",
    Erase = "ERASE",
};

export class BrushManager {
    public drawMode = DrawMode.Draw;
    public isPainting = false;

    private brushRadius = 0.2;
    private minBrushSize = 0.01;
	private maxBrushSize = 10;
    private lastPaintRay: BABYLON.Ray | null = null;

    private paintColor = new BABYLON.Color4(0, 1, 0, 1); // Green color for painting
	private highlightColor = new BABYLON.Color4(235 / 255, 137 / 255, 52 / 255, 1); // white

    private highlightedPointIdxs: number[] = [];
    // could be simplified, we have func to get original color back
    private originalColors = new Map<number, BABYLON.Color4>();

    constructor(
        private pointCloudManager: PointCloudManager,
        private scene: BABYLON.Scene,
        private cameraContainer: CameraContainer
    ) { }

    public adjustBrushSize(delta: number) {
        this.brushRadius = clamp(this.brushRadius - delta / 500, this.minBrushSize, this.maxBrushSize);
    }
    
    public startPainting(): void {
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
		let particleIdxsNearRay = null;

		this.clearHighlightedPoints();

		if (this.isPainting) {
			if (this.lastPaintRay == null) {
				particleIdxsNearRay = this.pointCloudManager.pcsLookup!.findParticlesNearRay(
					ray,
					rayLength,
					this.brushRadius,
					this.pointCloudManager.pcs!.particles
				);
			} else {
				const a = ray.origin;
				const b = ray.origin.add(ray.direction.normalize().scale(rayLength));
				const c = this.lastPaintRay.origin;
				const d = this.lastPaintRay.origin.add(this.lastPaintRay.direction.normalize().scale(rayLength));
				particleIdxsNearRay = this.pointCloudManager.pcsLookup!.findParticlesNearRectangle(
					a,
					b,
					c,
					d,
					this.brushRadius,
					this.pointCloudManager.pcs!.particles
				);
			}
			this.lastPaintRay = ray;

			particleIdxsNearRay!.forEach((i) => {
				const particle = this.pointCloudManager.pcs!.particles[i];
				let targetColor: BABYLON.Color4 | null = null;
				let classValue: number | null = null;
				if (this.drawMode === DrawMode.Draw) {
					targetColor = this.paintColor;
					classValue = 1;
				} else if (this.drawMode === DrawMode.Erase) {
					targetColor = this.pointCloudManager.getParticleInitColor(particle);
					classValue = 0;
				}

				if (targetColor && classValue !== null) {
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
				}
			});
		} else {
			if (this.cameraContainer.activeControlCamera!.name === 'orbitCamera') {
				// can't be used currently because too slow with spatial hashing datastructure
				return;
			}
			this.highlightedPointIdxs = this.pointCloudManager.pcsLookup!.findParticlesNearRay(
				ray,
				rayLength,
				this.brushRadius,
				this.pointCloudManager.pcs!.particles
			);
			this.highlightedPointIdxs.forEach((i) => {
				const particle = this.pointCloudManager.pcs!.particles[i];
				this.originalColors.set(i, particle.color!.clone());
                this.pointCloudManager.setParticleColor(i, this.highlightColor);
			});
		}
    }

    private clearHighlightedPoints() {
		if (this.highlightedPointIdxs.length > 0) {
			this.highlightedPointIdxs.forEach((i) => {
				if (this.originalColors.has(i)) {
                    this.pointCloudManager.setParticleColor(i, this.originalColors.get(i)!);
				}
			});
			this.highlightedPointIdxs = [];
			this.originalColors.clear();
		}
	};
}
