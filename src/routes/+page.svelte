<script lang="ts">
	import { onMount } from 'svelte';
	import * as BABYLON from '@babylonjs/core';
	import { setupCamera, CameraContainer } from '$lib/camera';
	import { BrushManager } from '$lib/brush';
	import { PointCloudManager } from '$lib/pointcloud';
	import { HistoryManager } from '$lib/history_manager';
	import { PolygonManager } from '$lib/polygon_manager';
	import { SimState, DrawMode } from '$lib/state.svelte';

	let canvas: HTMLCanvasElement;
	let scene: BABYLON.Scene | null = null;
	let fps: HTMLElement;
	let infoText: HTMLElement;
	let cameraContainer = new CameraContainer();

	let simState: SimState = new SimState();
	let pointCloudManager: PointCloudManager;
	let polygonManager: PolygonManager;
	let brushManager: BrushManager;
	let historyManager: HistoryManager;

	let lastCursorX = 0;
	let lastCursorY = 0;
	let pendingCursorUpdate = false;

	$effect(() => {
		if (infoText) {
			switch (simState.drawMode) {
				case DrawMode.Draw:
					infoText.innerHTML = 'Drawing';
					break;
				case DrawMode.Erase:
					infoText.innerHTML = 'Erasing';
					break;
				case DrawMode.Poly:
					infoText.innerHTML = 'Polygon';
					break;
			}
		}
	});

	const createScene = function (engine: BABYLON.Engine): BABYLON.Scene {
		const scene = new BABYLON.Scene(engine);
		setupCamera(canvas, engine, scene, cameraContainer);

		const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);
		// const light = new BABYLON.DirectionalLight('directional', new BABYLON.Vector3(0, -1, 0), scene);
		// light.intensity = 0.7;

		pointCloudManager = new PointCloudManager(scene);
		// TODO: port may be updated
		pointCloudManager.loadPointCloud('http://127.0.0.1:8000/pcd').then(() => {
			historyManager = new HistoryManager(pointCloudManager);
			polygonManager = new PolygonManager(
				scene,
				pointCloudManager,
				historyManager,
				cameraContainer
			);
			brushManager = new BrushManager(
				pointCloudManager,
				polygonManager,
				scene,
				cameraContainer,
				simState
			);
		});

		return scene;
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === '1') {
			simState.drawMode = DrawMode.Draw;
		}
		if (event.key === '2') {
			simState.drawMode = DrawMode.Erase;
		}
		if (event.key === '3') {
			simState.drawMode = DrawMode.Poly;
		}
		if (event.ctrlKey && event.key === 'z') {
			if (historyManager) historyManager.undo();
		}
		if (event.ctrlKey && event.key === 'y') {
			if (historyManager) historyManager.redo();
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
			if (!brushManager) return;
			const event = pointerInfo.event as PointerEvent;
			if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
				if (event.ctrlKey) {
					const xDiff = lastCursorX - scene!.pointerX;
					brushManager.adjustBrushSize(xDiff);
				}

				lastCursorX = scene!.pointerX;
				lastCursorY = scene!.pointerY;
				pendingCursorUpdate = true;
			}

			switch (pointerInfo.type) {
				case BABYLON.PointerEventTypes.POINTERDOWN:
					if (event.button === 0) {
						// Left mouse button
						brushManager.startPainting();
						if (simState.drawMode === DrawMode.Poly)
							polygonManager.onClick(lastCursorX, lastCursorY);
						pendingCursorUpdate = true;
					}
					break;

				case BABYLON.PointerEventTypes.POINTERUP:
					if (event.button === 0 && brushManager.isPainting) {
						brushManager.stopPainting();
						pendingCursorUpdate = true;
						historyManager.saveState();
					}
					break;
			}
		});

		scene.onBeforeRenderObservable.add(() => {
			if (pendingCursorUpdate) {
				brushManager.updateCursor(lastCursorX, lastCursorY);
				pendingCursorUpdate = false;
			}
			if (pointCloudManager) pointCloudManager.updatePointCloud();
		});

		window.addEventListener('keydown', handleKeyDown);

		window.addEventListener('resize', () => {
			engine.resize();
		});
	});
</script>

<canvas bind:this={canvas} id="renderCanvas" style="width: 100%; height: 100vh;"></canvas>
<div bind:this={fps} id="fps">0</div>
<div bind:this={infoText} id="infoText">Drawing</div>

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
		user-select: none;
	}

	#infoText {
		position: fixed;
		bottom: 4px;
		right: 4px;
		background-color: rgba(0, 0, 0, 0.3);
		color: white;
		padding: 2px 4px;
		border-radius: 5px;
		font-family: monospace;
		font-size: 12px;
		z-index: 1000;
		user-select: none;
	}
</style>
