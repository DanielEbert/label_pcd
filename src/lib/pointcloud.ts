import * as BABYLON from '@babylonjs/core';
import { SpatialHash } from './spatial_hash';

export class PointCloudManager {
	public pcs: BABYLON.PointsCloudSystem | null = null;
	public pcsLookup: SpatialHash | null = null;
	public pcsClass: number[] | null = null;
	public initialPointColor: BABYLON.Color4[] | null = null;
	private updatedParticleIdxs = new Set<number>();
	private _isPointCloudReady = false;
	private spatialHashCellSize = 0.4;

	constructor(private scene: BABYLON.Scene) {}

	public isPointCloudReady(): boolean {
		return this._isPointCloudReady && this.pcs !== null && this.pcs.particles !== null;
	}

	public async loadPointCloud(url: string): Promise<void> {
		try {
			const response = await fetch(url);
			const data = await response.json();

			let particlePositions = [];
			for (let point of data) {
				particlePositions.push(new BABYLON.Vector3(point[0], point[2], point[1]));
			}

			this.initialPointColor = this.getPointCloudColor(particlePositions);
			this.pcs = new BABYLON.PointsCloudSystem('pcs', 1, this.scene);

			const particleFunction = (
				particle: BABYLON.Particle,
				i: number,
				s: BABYLON.PointsCloudSystem
			) => {
				if (i >= data.length) return;
				particle.position = particlePositions[i];
				particle.color = this.getParticleInitColor(i);
			};
			this.pcs.addPoints(data.length, particleFunction);

			await this.pcs.buildMeshAsync();
			this._isPointCloudReady = true;
			this.pcsLookup = new SpatialHash(this.spatialHashCellSize, particlePositions);
			this.pcsClass = Array(data.length).fill(0);

			return Promise.resolve();
		} catch (error) {
			return Promise.reject(error);
		}
	}

	getPointCloudColor = (positions: BABYLON.Vector3[]) => {
		// not the best because naturally points closer to the car will ahve higher density. but maybe we can integrate that somehow
		const densityGrid = new Map<String, number>();
		const maxHeightGrid = new Map<String, number>();

		const grid = new SpatialHash(0.05, positions);

		let colors = Array(positions.length).fill(BABYLON.Color3.White);

		let minDensity = Infinity;
		let maxDensity = -Infinity;
		let minHeight = Infinity;
		let maxHeight = -Infinity;
		grid.grid.forEach((idxs, grid_key) => {
			const density = idxs.length;
			densityGrid.set(grid_key, density);
			minDensity = Math.min(minDensity, density);
			maxDensity = Math.max(maxDensity, density);

			let cellMaxHeight = -Infinity;
			idxs.forEach((idx) => {
				const pointHeight = positions[idx].y;
				if (pointHeight > cellMaxHeight) cellMaxHeight = pointHeight;
			});
			// console.log(cellMaxHeight);
			// log1p requires positive values
			// cellMaxHeight = Math.log1p(Math.max(cellMaxHeight, 0));
			maxHeightGrid.set(grid_key, cellMaxHeight);
			minHeight = Math.min(minHeight, cellMaxHeight);
			maxHeight = Math.max(maxHeight, cellMaxHeight);
		});

		const normalizeDensity = (value: number): number => {
			if (isNaN(value) || maxDensity === minDensity) return 0;
			return (value - minDensity) / (maxDensity - minDensity);
		};

		const normalizeHeight = (value: number): number => {
			if (value === Number.NEGATIVE_INFINITY || isNaN(value) || maxHeight === minHeight) return 0;
			return (value - minHeight) / (maxHeight - minHeight);
		};

		const getColor = (value: number): BABYLON.Color4 => {
			const color3 = BABYLON.Color3.FromHSV(
				(1 - value) * 360, // hue from blue to red
				0.7, // saturation
				1 // value
			);
			return new BABYLON.Color4(color3.r, color3.g, color3.b, 1);
		};

		grid.grid.forEach((idxs, grid_key) => {
			const normalizedDensity = normalizeDensity(densityGrid.get(grid_key)!);
			const height = maxHeightGrid.get(grid_key)!;
			const normalizedHeight = normalizeHeight(height);

			// Combine density and height (50% each)
			// const combinedValue = 0.5 * normalizedDensity + 0.5 * normalizedHeight;
			const combinedValue = normalizedHeight;

			idxs.forEach((idx) => (colors[idx] = getColor(combinedValue)));
		});

		return colors;
	};

	getParticleInitColor = (idx: number) => {
		// maybe this is better, i dont know. should maybe color based on density of cell here,
		// maybe pre-cald on frontend and stored in special val of each particle
		return this.initialPointColor![idx];
		return new BABYLON.Color4(1, 1, 1, 1);

		const height = particle.position.y;
		const minHeight = -3;
		const maxHeight = 2;

		// Shift the range to positive values for log scaling
		const shiftedHeight = height - minHeight + 1e-6; // add small epsilon to avoid log(0)
		const shiftedMax = maxHeight - minHeight + 1e-6;

		const logHeight = Math.log(shiftedHeight);
		const logMax = Math.log(shiftedMax);

		const normalizedHeight = logHeight / logMax;
		const clampedHeight = Math.max(0, Math.min(1, normalizedHeight));

		const color3 = BABYLON.Color3.FromHSV(
			(1 - clampedHeight) * 360, // hue from blue to red
			1.0, // saturation
			1.0 // value
		);

		return new BABYLON.Color4(color3.r, color3.g, color3.b, 1.0);
	};

	public setParticleClasses(classes: number[]): void {
		if (!this.pcsClass || !this.isPointCloudReady() || !this.pcs || !this.pcs.particles) {
			return;
		}

		this.pcsClass = [...classes];

		for (let i = 0; i < this.pcsClass.length; i++) {
			const classValue = this.pcsClass[i];
			const particle = this.pcs.particles[i];

			if (classValue === 1) {
				particle.color = new BABYLON.Color4(0, 1, 0, 1);
			} else {
				particle.color = this.getParticleInitColor(i);
			}

			this.updatedParticleIdxs.add(i);
		}
	}

	public updatePointCloud(): void {
		if (!this.isPointCloudReady() || !this.pcs || this.updatedParticleIdxs.size === 0) {
			return;
		}

		const sorted = Array.from(this.updatedParticleIdxs).sort((a, b) => a - b);
		const startIdx = sorted[0];
		const endIdx = sorted[sorted.length - 1];

		this.pcs.setParticles(startIdx, endIdx);
		this.updatedParticleIdxs.clear();
	}

	public setParticleColor(particleIndex: number, color: BABYLON.Color4): boolean {
		if (!this.isPointCloudReady() || !this.pcs || !this.pcs.particles) {
			return false;
		}

		const particle = this.pcs.particles[particleIndex];
		const currentColor = particle.color;

		if (
			!currentColor ||
			currentColor.r !== color.r ||
			currentColor.g !== color.g ||
			currentColor.b !== color.b ||
			currentColor.a !== color.a
		) {
			particle.color = color.clone();
			this.updatedParticleIdxs.add(particleIndex);
			return true;
		}
		return false;
	}
}
