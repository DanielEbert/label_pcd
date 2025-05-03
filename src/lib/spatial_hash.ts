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
        this.getCellsNearLine(ray, length, radius).forEach(cellKey => {
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

    getCellsNearRectangle(a: BABYLON.Vector3, b: BABYLON.Vector3, c: BABYLON.Vector3, d: BABYLON.Vector3, maxDistance: number): Set<string> {
        const cells = new Set<string>();

        let minX = Math.min(a.x, b.x, c.x, d.x);
        let minY = Math.min(a.y, b.y, c.y, d.y);
        let minZ = Math.min(a.z, b.z, c.z, d.z);
        let maxX = Math.max(a.x, b.x, c.x, d.x);
        let maxY = Math.max(a.y, b.y, c.y, d.y);
        let maxZ = Math.max(a.z, b.z, c.z, d.z);

        minX -= maxDistance;
        minY -= maxDistance;
        minZ -= maxDistance;
        maxX += maxDistance;
        maxY += maxDistance;
        maxZ += maxDistance;

        const minCellX = Math.floor(minX / this.cellSize);
        const minCellY = Math.floor(minY / this.cellSize);
        const minCellZ = Math.floor(minZ / this.cellSize);
        const maxCellX = Math.floor(maxX / this.cellSize);
        const maxCellY = Math.floor(maxY / this.cellSize);
        const maxCellZ = Math.floor(maxZ / this.cellSize);

        for (let ix = minCellX; ix <= maxCellX; ix++) {
            for (let iy = minCellY; iy <= maxCellY; iy++) {
                for (let iz = minCellZ; iz <= maxCellZ; iz++) {
                    cells.add(`${ix},${iy},${iz}`);
                }
            }
        }

        return cells;
    }

    // Use the corners that define the origin and adjacent sides
    getClosestPointOnRectangle(p: BABYLON.Vector3, a: BABYLON.Vector3, b: BABYLON.Vector3, c: BABYLON.Vector3): BABYLON.Vector3 {
        const vec_ab = b.subtract(a);
        const vec_ad = c.subtract(a);
        const vec_ap = p.subtract(a);

        const len_sq_ab = vec_ab.lengthSquared();
        const len_sq_ad = vec_ad.lengthSquared();

        // Calculate u parameter (projection onto AB direction)
        let u = 0;
        // Handle potential zero-length side AB
        if (len_sq_ab > 1e-10) {
            u = BABYLON.Vector3.Dot(vec_ap, vec_ab) / len_sq_ab;
        }

        // Calculate v parameter (projection onto AD direction)
        let v = 0;
        // Handle potential zero-length side AD
        if (len_sq_ad > 1e-10) {
            v = BABYLON.Vector3.Dot(vec_ap, vec_ad) / len_sq_ad;
        }

        // Clamp parameters u and v to the range [0, 1]
        const u_clamped = Math.max(0, Math.min(1, u));
        const v_clamped = Math.max(0, Math.min(1, v));

        // Calculate the closest point: Q = A + u_clamped * AB + v_clamped * AD
        // Babylon.js Vector3 operations typically return new vectors (immutable style)
        const closest_point = a.add(vec_ab.scale(u_clamped)).add(vec_ad.scale(v_clamped));

        return closest_point;
    }

    findParticlesNearRectangle(
        a: BABYLON.Vector3, b: BABYLON.Vector3, c: BABYLON.Vector3, d: BABYLON.Vector3,
        maxDistance: number, particles: BABYLON.CloudPoint[]
    ) {
        const result: number[] = [];
        const maxDistanceSq = maxDistance * maxDistance;

        this.getCellsNearRectangle(a, b, c, d, maxDistance).forEach(cellKey => {
            const indices = this.grid.get(cellKey);
            if (!indices) return;
            indices.forEach(i => {
                const particle = particles[i];
                if (!particle || !particle.position) return;
                const closestPoint = this.getClosestPointOnRectangle(particle.position, a, b, c);
                const distanceSq = BABYLON.Vector3.DistanceSquared(particle.position, closestPoint);
                if (distanceSq < maxDistanceSq) result.push(i);
            })
        })
        return result;
    }
}
