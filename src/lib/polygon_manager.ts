import * as BABYLON from '@babylonjs/core';
import { Polygon } from "./polygon";
import type { PointCloudManager } from './pointcloud';
import type { HistoryManager } from './history_manager';

export class PolygonManager {
    public polygons: Polygon[] = [];
    // TODO: is also in brushmanager, should put into common config file
    private paintColor = new BABYLON.Color4(0, 1, 0, 1); // Green color for painting

    constructor(private scene: BABYLON.Scene, private pointCloudManager: PointCloudManager, private historyManager: HistoryManager) {
        const builder = new Polygon(scene, this, {
            closePath: true
        });
        builder.addPoint(new BABYLON.Vector3(0, -2.5, 0));
        builder.addPoint(new BABYLON.Vector3(1, -2.5, 0));
        builder.addPoint(new BABYLON.Vector3(1, -2.5, 1));
        builder.addPoint(new BABYLON.Vector3(0, -2.5, 1));
        this.polygons.push(builder);
    }

    onColorPolygon(poly: Polygon) {
        console.log('h1')
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
                particle.color.r !== this.paintColor.r ||
                particle.color.g !== this.paintColor.g ||
                particle.color.b !== this.paintColor.b ||
                particle.color.a !== this.paintColor.a
            ) {
                this.pointCloudManager.setParticleColor(i, this.paintColor);
                this.pointCloudManager.pcsClass![i] = classValue;
            }
        });

        this.historyManager.saveState();
    }

    onPolygonDeleted(polygon: Polygon) {
        this.polygons = this.polygons.filter(p => p !== polygon);
    }
}