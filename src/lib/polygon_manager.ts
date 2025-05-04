import * as BABYLON from '@babylonjs/core';
import { Polygon } from './polygon';
import type { PointCloudManager } from './pointcloud';
import type { HistoryManager } from './history_manager';
import type { CameraContainer } from './camera';
import { paintColor } from './config';

export class PolygonManager {
	public activePolygon: Polygon | null = null;
	public polygons: Polygon[] = [];

	constructor(
		private scene: BABYLON.Scene,
		private pointCloudManager: PointCloudManager,
		private historyManager: HistoryManager,
		private cameraContainer: CameraContainer
	) {}

	onClick(cursorX: number, cursorY: number) {
		console.log('on poly');
		if (!this.activePolygon) {
			console.log('Creating new polygon');
			this.activePolygon = new Polygon(this.scene, this, {
				closePath: true
			});
			this.polygons.push(this.activePolygon);
		}

		const ray = this.scene.createPickingRay(
			cursorX,
			cursorY,
			BABYLON.Matrix.Identity(),
			this.cameraContainer.activeControlCamera,
			false
		);
		this.activePolygon.addPoint(ray.origin);
	}

	onColorPolygon(poly: Polygon) {
		console.log('h1');
		const particlesInPolygon = this.pointCloudManager.pcsLookup!.findParticlesInPolygon(
			poly.nodePositions,
			this.pointCloudManager.pcs!.particles
		);

		particlesInPolygon.forEach((i) => {
			const particle = this.pointCloudManager.pcs!.particles[i];
			// TODO: put in common config
			let classValue: number = 1;

			if (
				!particle.color ||
				particle.color.r !== paintColor.r ||
				particle.color.g !== paintColor.g ||
				particle.color.b !== paintColor.b ||
				particle.color.a !== paintColor.a
			) {
				this.pointCloudManager.setParticleColor(i, paintColor);
				this.pointCloudManager.pcsClass![i] = classValue;
			}
		});

		this.historyManager.saveState();
	}

	onPolygonDeleted(polygon: Polygon) {
		this.polygons = this.polygons.filter((p) => p !== polygon);
		if (polygon === this.activePolygon) this.activePolygon = null;
	}
}
