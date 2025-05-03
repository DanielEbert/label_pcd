<script lang="ts">
	import { onMount } from 'svelte';
	import * as BABYLON from '@babylonjs/core';
	import { Polygon } from '$lib/polygon';
	import { setupCamera, CameraContainer } from '$lib/camera';
	import { SpatialHash } from '$lib/spatial_hash';
    import { clamp } from '$lib/util'

	let canvas: HTMLCanvasElement;
	let scene: BABYLON.Scene | null = null;
	let fps: HTMLElement;
	let pcs: BABYLON.PointsCloudSystem | null = null;
	let pcsLookup: SpatialHash | null = null;
    let pcsClass: number[] | null;
	let isPointCloudReady = false;
	let cameraContainer = new CameraContainer();

	// Paint Brush
	// TODO: refactor to lib
	let isPainting = false;
	const paintKey = '1'; // Key to trigger painting
	let brushRadius = 0.2; //world units distance from the ray
    const minBrushSize = 0.01;
    const maxBrushSize = 10;
	const paintColor = new BABYLON.Color4(0, 1, 0, 1); // Green color for painting
	const highlightColor = new BABYLON.Color4(1, 1, 1, 1); // white
	let highlightedPointIdxs: number[] = [];
	let originalColors = new Map<number, BABYLON.Color4>();
	let lastPaintRay: BABYLON.Ray | null = null;
	let lastCursorX = 0;
	let lastCursorY = 0;
	let pendingCursorUpdate = false;

	let updatedParticleIdxs = new Set<number>();

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
				// TODO: later create maxPointsCount here and then resuse later
				// const maxPointsCount = 128 * 900 * 4 * 2;
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
				pcs.addPoints(data.length, myfunc);
				pcs.buildMeshAsync().then((mesh: any) => {
					isPointCloudReady = true;
					pcsLookup = new SpatialHash(brushRadius * 2, pcs!.particles!);
				});
                // TODO: later give class thats in data
                pcsClass = Array(data.length).fill(0);
			})
			.catch((error) => console.error('Error:', error));

		return scene;
	};

	const paintPoints = () => {
		if (
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
			lastCursorX,
			lastCursorY,
			BABYLON.Matrix.Identity(),
			cameraContainer.activeControlCamera,
			false
		);
		ray.direction.normalize();

		const rayLength = 40;
		let particleIdxsNearRay = null;

		clearHighlightedPoints();

		if (isPainting) {
			if (lastPaintRay == null) {
				particleIdxsNearRay = pcsLookup!.findParticlesNearRay(
					ray,
					rayLength,
					brushRadius,
					pcs.particles
				);
			} else {
				const a = ray.origin;
				const b = ray.origin.add(ray.direction.normalize().scale(rayLength));
				const c = lastPaintRay.origin;
				const d = lastPaintRay.origin.add(lastPaintRay.direction.normalize().scale(rayLength));
				particleIdxsNearRay = pcsLookup!.findParticlesNearRectangle(
					a,
					b,
					c,
					d,
					brushRadius,
					pcs.particles
				);
			}
			lastPaintRay = ray;

			particleIdxsNearRay!.forEach((i) => {
				const particle = pcs!.particles[i];
				if (
					!particle.color ||
					particle.color.r !== paintColor.r ||
					particle.color.g !== paintColor.g ||
					particle.color.b !== paintColor.b ||
					particle.color.a !== paintColor.a
				) {
					particle.color = paintColor.clone();
					updatedParticleIdxs.add(i);
                    pcsClass![i] = 1;
					// console.log(`Painting point index: ${i}`); // Debugging
				}
			});
		} else {
			if (cameraContainer.activeControlCamera.name === 'orbitCamera') {
				// can't be used currently because too slow with spatial hashing datastructure
				return;
			}
			highlightedPointIdxs = pcsLookup!.findParticlesNearRay(
				ray,
				rayLength,
				brushRadius,
				pcs.particles
			);
			highlightedPointIdxs.forEach((i) => {
				const particle = pcs!.particles[i];
				originalColors.set(i, particle.color!.clone());
				particle.color = highlightColor;
				updatedParticleIdxs.add(i);
			});
		}
	};

	const clearHighlightedPoints = () => {
		if (highlightedPointIdxs.length > 0 && pcs && pcs.particles) {
			highlightedPointIdxs.forEach((i) => {
				if (originalColors.has(i)) {
					pcs!.particles[i].color = originalColors.get(i)!;
					updatedParticleIdxs.add(i);
				}
			});
			highlightedPointIdxs = [];
			originalColors.clear();
		}
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === paintKey && !isPainting) {
			isPainting = true;
			pendingCursorUpdate = true;
		}
	};

	const handleKeyUp = (event: KeyboardEvent) => {
		if (event.key === paintKey && isPainting) {
			isPainting = false;
			lastPaintRay = null;
			pendingCursorUpdate = true;
		}
	};

	onMount(async () => {
		const engine = new BABYLON.Engine(canvas, true);
		scene = createScene(engine);
		const sceneToRender = scene;

		engine.runRenderLoop(function () {
			if (sceneToRender && sceneToRender.activeCamera) {
				sceneToRender.render();
				if (fps) {
					fps.innerHTML = engine.getFps().toFixed() + ' fps';
				}
			}
		});

		scene.onPointerObservable.add((pointerInfo) => {
			if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
                const event = pointerInfo.event as PointerEvent;
                if (event.altKey) {
                    const xDiff = lastCursorX - scene!.pointerX;
                    brushRadius = clamp(brushRadius - xDiff / 500, minBrushSize, maxBrushSize)
                }

				lastCursorX = scene!.pointerX;
				lastCursorY = scene!.pointerY;
				pendingCursorUpdate = true;
			}
		});

		scene.onBeforeRenderObservable.add(() => {
			if (pendingCursorUpdate) {
				paintPoints();
				pendingCursorUpdate = false;
			}
			if (pcs && updatedParticleIdxs.size > 0) {
				const sorted = Array.from(updatedParticleIdxs).sort((a, b) => a - b);
				const startIdx = sorted[0];
				const endIdx = sorted[sorted.length - 1];
				pcs.setParticles(startIdx, endIdx);
                updatedParticleIdxs.clear();
			}
		});

		// --- Add Event Listeners ---
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);

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
