import * as BABYLON from '@babylonjs/core'
import { SpatialHash } from './spatial_hash';

export class PointCloudManager {
    public pcs: BABYLON.PointsCloudSystem | null = null;
    public pcsLookup: SpatialHash | null = null;
    public pcsClass: number[] | null = null;
    private updatedParticleIdxs = new Set<number>();
    private _isPointCloudReady = false;
    private spatialHashCellSize = 0.4;

    constructor(private scene: BABYLON.Scene) { }

    public isPointCloudReady(): boolean {
        return this._isPointCloudReady && this.pcs !== null && this.pcs.particles !== null;
    }

    public async loadPointCloud(url: string): Promise<void> {
        try {
            const response = await fetch(url);
            const data = await response.json();
            this.pcs = new BABYLON.PointsCloudSystem('pcs', 1, this.scene);

            const particleFunction = (particle: BABYLON.Particle, i: number, s: BABYLON.PointsCloudSystem) => {
                if (i >= data.length) return;
                particle.position = new BABYLON.Vector3(data[i][0], data[i][2], data[i][1]);
                particle.color = this.getParticleInitColor(particle);
            };
            this.pcs.addPoints(data.length, particleFunction);

            await this.pcs.buildMeshAsync();
            this._isPointCloudReady = true;
            this.pcsLookup = new SpatialHash(this.spatialHashCellSize, this.pcs.particles!);
            this.pcsClass = Array(data.length).fill(0);

            return Promise.resolve();
        } catch (error) {
            return Promise.reject(error);
        }
    }

    getParticleInitColor = (particle: BABYLON.Particle | BABYLON.CloudPoint) => {
        // maybe this is better, i dont know. should maybe color based on density of cell here,
        // maybe pre-cald on frontend and stored in special val of each particle
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
                particle.color = this.getParticleInitColor(particle);
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
        
        if (!currentColor || 
            currentColor.r !== color.r || 
            currentColor.g !== color.g || 
            currentColor.b !== color.b || 
            currentColor.a !== color.a) {
            
            particle.color = color.clone();
            this.updatedParticleIdxs.add(particleIndex);
            return true;
        }
        return false;
    }
}