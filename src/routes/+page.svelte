<script lang="ts">
	import { onMount } from 'svelte';
	import * as BABYLON from '@babylonjs/core';
	import { Polygon } from '$lib/polygon';
	import { setupCamera, CameraContainer } from '$lib/camera';
	import { SpatialHash } from '$lib/spatial_hash';

	let canvas: HTMLCanvasElement;
	let scene: BABYLON.Scene | null = null;
	let fps: HTMLElement;
	let pcs: BABYLON.PointsCloudSystem | null = null;
    let pcsLookup: SpatialHash | null = null;
	let isPointCloudReady = false;
    let cameraContainer = new CameraContainer();

	// --- Paint Brush Logic State ---
	let isPainting = false;
	const paintKey = '1'; // Key to trigger painting
	const brushRadius = 0.2; //world units distance from the ray
	const paintColor = new BABYLON.Color4(0, 1, 0, 1); // Green color for painting
	let paintedPointIndices = new Set<number>();
	let needsPCSUpdate = false;

	const createScene = function (engine: BABYLON.Engine): BABYLON.Scene {
		const scene = new BABYLON.Scene(engine);
		setupCamera(canvas, engine, scene, cameraContainer);

		const light = new BABYLON.DirectionalLight('directional', new BABYLON.Vector3(0, -1, 0), scene);
		light.intensity = 0.7;

		const builder = new Polygon(scene, {
			nodeDiameter: 0.1,
			nodeHeight: 3,
			nodeColor: BABYLON.Color3.Purple(),
			wallThickness: 0.02,
			wallColor: BABYLON.Color3.Red(),
			closePath: true
		});
		builder.addPoint(new BABYLON.Vector3(0, 0, 0));
		builder.addPoint(new BABYLON.Vector3(1, 0, 0));
		builder.addPoint(new BABYLON.Vector3(1, 0, 1));
		builder.addPoint(new BABYLON.Vector3(0, 0, 1));

		// TODO: back to 8000
		fetch('http://127.0.0.1:8001/pcd')
			.then((response) => response.json())
			.then((data) => {
				console.log('here');
				// TODO: later create maxPointsCount here and then resuse later
				const maxPointsCount = 128 * 900 * 4 * 2;
				pcs = new BABYLON.PointsCloudSystem('pcs', 1, scene);
				const myfunc = function (
					particle: BABYLON.Particle,
					i: number,
					s: BABYLON.PointsCloudSystem
				) {
					if (i >= data.length) return;
					particle.position = new BABYLON.Vector3(data[i][0], data[i][2], data[i][1]);

					const height = data[i][2];
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

					particle.color = new BABYLON.Color4(color3.r, color3.g, color3.b, 1.0);
				};
				pcs.addPoints(maxPointsCount, myfunc);
				pcs.buildMeshAsync().then((mesh: any) => {
					isPointCloudReady = true;
                    pcsLookup = new SpatialHash(brushRadius * 2, pcs!.particles!);
				});
			})
			.catch((error) => console.error('Error:', error));

		return scene;
	};

	const paintPoints = () => {
		if (
			!isPainting ||
			!isPointCloudReady ||
			!pcs ||
			!scene ||
			!scene.activeCamera ||
            !cameraContainer.activeControlCamera ||
			!pcs.particles ||
			pcs.particles.length == 0
		)
			return;
		const ray = scene.createPickingRay(
			scene.pointerX,
			scene.pointerY,
			BABYLON.Matrix.Identity(),
			cameraContainer.activeControlCamera,
			false
		);
		ray.direction.normalize();
		let pointsChanged = false;

        let startTime = performance.now()

        pcsLookup!.findParticlesNearRay(ray, 40, brushRadius, pcs.particles).forEach(i => {
            const particle = pcs!.particles[i];
            if (
					!particle.color ||
					particle.color.r !== paintColor.r ||
					particle.color.g !== paintColor.g ||
					particle.color.b !== paintColor.b ||
					particle.color.a !== paintColor.a
				) {
					particle.color = paintColor.clone();
					paintedPointIndices.add(i);
					pointsChanged = true;
					// console.log(`Painting point index: ${i}`); // Debugging
				}
        })

  /*
		// TODO: should have data structure for points for faster lookup, like spatial hashing
		for (let i = 0; i < pcs.particles.length; i++) {
			const particle = pcs.particles[i];
			if (!particle || !particle.position) continue;
            // TODO: should  check if point is behind camera
			// Calculate distance from point to the infinite line defined by the ray
			// Using Vector3.Cross product magnitude: ||(point - ray.origin) x ray.direction|| / ||ray.direction||
			// Since ray.direction is normalized, denominator is 1.
			const pointToOrigin = particle.position.subtract(ray.origin);
			const crossProduct = BABYLON.Vector3.Cross(pointToOrigin, ray.direction);
			const distanceToRay = crossProduct.length();

			if (distanceToRay <= brushRadius) {
				if (
					!particle.color ||
					particle.color.r !== paintColor.r ||
					particle.color.g !== paintColor.g ||
					particle.color.b !== paintColor.b ||
					particle.color.a !== paintColor.a
				) {
					particle.color = paintColor.clone();
					paintedPointIndices.add(i);
					pointsChanged = true;
					// console.log(`Painting point index: ${i}`); // Debugging
				}
			}
		}*/

		if (pointsChanged) {
			needsPCSUpdate = true;
		}

        console.log('->', performance.now() - startTime)
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === paintKey && !isPainting) {
			isPainting = true;
            paintPoints();
			// console.log("Painting started"); // Debug
			// Optionally change cursor style
			// canvas.style.cursor = 'crosshair';
		}
	};

	const handleKeyUp = (event: KeyboardEvent) => {
		if (event.key === paintKey && isPainting) {
			isPainting = false;
			// console.log("Painting stopped"); // Debug
			// Restore cursor style
			// canvas.style.cursor = 'default';
		}
	};

	const handlePointerMove = (event: PointerEvent) => {
		// here to ensures responsiveness to mouse movement *while* painting.
		if (isPainting) {
			paintPoints();
		}
	};

	onMount(async () => {
		const engine = new BABYLON.Engine(canvas, true);
		scene = createScene(engine);
		const sceneToRender = scene;

		engine.runRenderLoop(function () {
			if (sceneToRender && sceneToRender.activeCamera) {
				sceneToRender.render();
				fps.innerHTML = engine.getFps().toFixed() + ' fps';
			}
		});

		scene.onBeforeRenderObservable.add(() => {
			if (needsPCSUpdate && pcs) {
				// console.log("Calling pcs.setParticles()"); // Debug
				pcs.setParticles();
				needsPCSUpdate = false;
			}
		});

		// --- Add Event Listeners ---
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		canvas.addEventListener('pointermove', handlePointerMove);

		window.addEventListener('resize', function () {
			engine.resize();
		});
	});
</script>

<canvas bind:this={canvas} id="renderCanvas" style="width: 100%; height: 100vh;"></canvas>
<div bind:this={fps} id="fps">0</div>

<style>
	#fps {
		position: absolute;
		background-color: black;
		border: 2px solid red;
		text-align: center;
		font-size: 16px;
		color: white;
		top: 15px;
		right: 10px;
		width: 60px;
		height: 20px;
	}
</style>
