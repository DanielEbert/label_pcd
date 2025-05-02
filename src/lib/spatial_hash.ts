import * as BABYLON from '@babylonjs/core';

export class SpatialHash {
    private grid: Map<string, number[]> = new Map()
    constructor(private cellSize: number, particles: BABYLON.CloudPoint[]) {
        particles.forEach((particle: BABYLON.CloudPoint, index: number) => {
            if (!particle || !particle.position) return;
            const cellX = Math.floor(particle.position.x / cellSize);
            const cellY = Math.floor(particle.position.y / cellSize);
            const cellZ = Math.floor(particle.position.z / cellSize);
            const cellKey = `${cellX},${cellY},${cellZ}`;

            if (!this.grid.has(cellKey)) {
                this.grid.set(cellKey, []);
            }
            this.grid.get(cellKey)!.push(index);
        })
    }

    getCellsNearLine(ray: BABYLON.Ray, length: number, radius: number): Set<string> {
        const start = ray.origin;
        const end = ray.origin.add(ray.direction.scale(length));
        const cells = new Set<string>;
        const expandedRadius = radius + this.cellSize;

        // Get the bounding box of the line + radius
        const minX = Math.min(start.x, end.x) - expandedRadius;
        const maxX = Math.max(start.x, end.x) + expandedRadius;
        const minY = Math.min(start.y, end.y) - expandedRadius;
        const maxY = Math.max(start.y, end.y) + expandedRadius;
        const minZ = Math.min(start.z, end.z) - expandedRadius;
        const maxZ = Math.max(start.z, end.z) + expandedRadius;

        // Convert to cell coordinates
        const minCellX = Math.floor(minX / this.cellSize);
        const maxCellX = Math.floor(maxX / this.cellSize);
        const minCellY = Math.floor(minY / this.cellSize);
        const maxCellY = Math.floor(maxY / this.cellSize);
        const minCellZ = Math.floor(minZ / this.cellSize);
        const maxCellZ = Math.floor(maxZ / this.cellSize);

        // Collect all potentially intersecting cells
        for (let x = minCellX; x <= maxCellX; x++) {
            for (let y = minCellY; y <= maxCellY; y++) {
                for (let z = minCellZ; z <= maxCellZ; z++) {
                    const cellKey = `${x},${y},${z}`;
                    if (this.grid.has(cellKey)) {
                        cells.add(cellKey);
                    }
                }
            }
        }

        return cells;
    }

    findParticlesNearRay(ray: BABYLON.Ray, length: number, radius: number, particles: BABYLON.CloudPoint[]): number[] {
        const result: number[] = []
        const cellsToCheck = this.getCellsNearLine(ray, length, radius);
        cellsToCheck.forEach(cellKey => {
            const indices = this.grid.get(cellKey);
            if (!indices) return;
            indices.forEach(i => {
                const particle = particles[i];
                if (!particle || !particle.position) return;

                // TODO: check if in front of camera
                const pointToOrigin = particle.position.subtract(ray.origin);
                const crossProduct = BABYLON.Vector3.Cross(pointToOrigin, ray.direction);
                const distanceToRay = crossProduct.length();

                if (distanceToRay <= radius) result.push(i);
            })
        })

        return result;
    }
}