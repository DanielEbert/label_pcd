<script lang="ts">
	import { onMount } from 'svelte';
	import * as BABYLON from '@babylonjs/core';
	import { Polygon } from '$lib/Polygon';
	import { setupCamera } from '$lib/camera';

	var createScene = function (engine: BABYLON.Engine): BABYLON.Scene {
		const scene = new BABYLON.Scene(engine);
		setupCamera(canvas, engine, scene);

		var light = new BABYLON.DirectionalLight('directional', new BABYLON.Vector3(0, -1, 0), scene);
		light.intensity = 0.7;

		const builder = new Polygon(scene, {
			nodeSize: 20,
			nodeColor: BABYLON.Color3.Purple(),
			wallThickness: 5,
			wallHeight: 10,
			wallColor: BABYLON.Color3.Red(),
			closePath: true
		});
		builder.addPoint(new BABYLON.Vector3(0, 0, 0));
		builder.addPoint(new BABYLON.Vector3(100, 0, 0));
		builder.addPoint(new BABYLON.Vector3(100, 0, 100));
		builder.addPoint(new BABYLON.Vector3(0, 0, 100));

		var pcs = new BABYLON.PointsCloudSystem('pcs', 5, scene);
		var myfunc = function (particle: BABYLON.Particle, i: number, s: BABYLON.PointsCloudSystem) {
			particle.position = new BABYLON.Vector3(
				100 * Math.random(),
				100 * Math.random(),
				100 * Math.random()
			);
			particle.color = new BABYLON.Color4(
				Math.random(),
				Math.random(),
				Math.random(),
				Math.random()
			);
		};
		pcs.addPoints(100, myfunc);
		pcs.buildMeshAsync();

		return scene;
	};

	let canvas: HTMLCanvasElement;

	onMount(async () => {
		const engine = new BABYLON.Engine(canvas, true);
		const scene = createScene(engine);
		const sceneToRender = scene;

		engine.runRenderLoop(function () {
			if (sceneToRender && sceneToRender.activeCamera) {
				sceneToRender.render();
			}
		});

		window.addEventListener('resize', function () {
			engine.resize();
		});
	});
</script>

<canvas bind:this={canvas} id="renderCanvas" style="width: 100%; height: 100vh;"></canvas>
