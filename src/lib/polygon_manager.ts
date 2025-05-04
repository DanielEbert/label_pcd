import * as BABYLON from '@babylonjs/core';
import { Polygon } from "./polygon";

export class PolygonManager {
    public polygons: Polygon[] = [];
    constructor(private scene: BABYLON.Scene) {
        const builder = new Polygon(scene, {
			closePath: true
		});
		builder.addPoint(new BABYLON.Vector3(0, -2.5, 0));
		builder.addPoint(new BABYLON.Vector3(1, -2.5, 0));
		builder.addPoint(new BABYLON.Vector3(1, -2.5, 1));
		builder.addPoint(new BABYLON.Vector3(0, -2.5, 1));
        this.polygons.push(builder);
    }
}