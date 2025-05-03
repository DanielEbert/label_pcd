import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';

export class CameraContainer {
    public activeControlCamera: BABYLON.Camera | null = null;
};

export class FreeCameraMousePanningInput implements BABYLON.ICameraInput<BABYLON.FreeCamera> {
    public camera!: BABYLON.FreeCamera;
    public panningSensibility: number = 1;
    public button: number = 2; // 0 for left button, 1 for middle, 2 for right

    private _isPanning: boolean = false;
    private _previousPointerPosition: { x: number; y: number } | null = null;
    private _observer: BABYLON.Observer<BABYLON.PointerInfo> | null = null;

    constructor(camera: BABYLON.FreeCamera) {
        this.camera = camera;
    }

    getClassName() {
        return 'FreeCameraMousePanningInput';
    }
    getSimpleName() {
        return 'mousePanning';
    }

    attachControl(noPreventDefault?: boolean | undefined): void {
        if (this._observer) {
            return; // Already attached
        }

        const engine = this.camera.getEngine();
        const scene = this.camera.getScene();
        this._previousPointerPosition = null;

        this._observer = scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.event.ctrlKey) return;
            const event = pointerInfo.event;

            if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                if (event.button === this.button) {
                    this._isPanning = true;
                    this._previousPointerPosition = { x: event.clientX, y: event.clientY };

                    if (!noPreventDefault) {
                        event.preventDefault();
                    }
                }
            } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
                if (event.button === this.button) {
                    this._isPanning = false;
                    this._previousPointerPosition = null;
                    if (!noPreventDefault) {
                        event.preventDefault();
                    }
                }
            } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
                if (this._isPanning && this._previousPointerPosition) {
                    const currentPosition = { x: event.clientX, y: event.clientY };
                    const deltaX =
                        (currentPosition.x - this._previousPointerPosition.x) / engine.getRenderWidth();
                    const deltaY =
                        (currentPosition.y - this._previousPointerPosition.y) / engine.getRenderHeight();

                    // Calculate movement based on camera's orientation and orthographic size
                    // Since camera looks down (rotation.x = PI/2), screen X maps to world -X, screen Y maps to world -Z
                    // The scale depends on the orthographic projection size
                    const moveX = -deltaX * (this.camera.orthoRight! - this.camera.orthoLeft!);
                    const moveZ = deltaY * (this.camera!.orthoTop! - this.camera.orthoBottom!); // Positive Z is typically "up" on the screen in this view

                    this.camera.position.x += moveX * this.panningSensibility;
                    // * 2 to account for camera viewport is screenHeight / 2
                    this.camera.position.z += moveZ * this.panningSensibility * 2;

                    this._previousPointerPosition = currentPosition;

                    if (!noPreventDefault) {
                        event.preventDefault();
                    }
                }
            }
        });
    }

    detachControl() {
        if (!this._observer) {
            return;
        }
        if (this.camera) {
            const scene = this.camera.getScene();
            scene.onPointerObservable.remove(this._observer);
            this._observer = null;
        }
        this._isPanning = false;
    }
}

export function setupCamera(
    canvas: HTMLCanvasElement,
    engine: BABYLON.Engine,
    scene: BABYLON.Scene,
    cc: CameraContainer
) {
    // --- Add Borders using GUI ---
    const adt = GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');

    const viewportBorder = new GUI.Rectangle();
    viewportBorder.width = 1;
    viewportBorder.height = 1;
    viewportBorder.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    viewportBorder.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
    viewportBorder.left = '0px';
    viewportBorder.top = '0px';
    viewportBorder.color = 'black';
    viewportBorder.thickness = 1;
    adt.addControl(viewportBorder);

    const orbitCamera = new BABYLON.ArcRotateCamera(
        'orbitCamera',
        (3 * Math.PI) / 8,
        (3 * Math.PI) / 8,
        30,
        new BABYLON.Vector3(0, 10, 0),
        scene
    );
    orbitCamera.viewport = new BABYLON.Viewport(0, 0.5, 1, 0.5);
    orbitCamera.inertia = 0.1;
    orbitCamera.panningInertia = 0.1;
    (orbitCamera.inputs.attached.pointers as BABYLON.ArcRotateCameraPointersInput).buttons = [0, 2];
    orbitCamera.wheelDeltaPercentage = 0.1;
    orbitCamera.angularSensibilityX = 150;
    orbitCamera.angularSensibilityY = 150;

    scene.onBeforeRenderObservable.add(() => {
        orbitCamera.panningSensibility = (3500 - Math.min(3000, orbitCamera.radius)) / 100;
    });

    const topDownCamera = new BABYLON.FreeCamera(
        'topDownCamera',
        new BABYLON.Vector3(0, 20, 0),
        scene
    );
    topDownCamera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    topDownCamera.viewport = new BABYLON.Viewport(0, 0, 1, 0.5);

    scene.activeCameras?.push(orbitCamera);
    scene.activeCameras?.push(topDownCamera);

    scene.onPointerObservable.add((pointerInfo) => {
        if (
            pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE ||
            pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN
        ) {
            const mouseY = pointerInfo.event.clientY;

            const canvasRect = engine.getRenderingCanvasClientRect();
            if (!canvasRect) return;
            const canvasHeight = canvasRect.height;
            const midpointY = canvasHeight / 2;

            const targetCamera = mouseY < midpointY ? orbitCamera : topDownCamera;

            if (targetCamera !== cc.activeControlCamera) {
                console.log(`Switching control to: ${targetCamera.name}`);

                if (cc.activeControlCamera) {
                    cc.activeControlCamera.detachControl();
                }

                targetCamera.attachControl(canvas, true);
                cc.activeControlCamera = targetCamera;
            }
        }
    });

    const updateOrtho = (orthoSize: number) => {
        const aspect = engine.getAspectRatio(orbitCamera);
        topDownCamera.orthoLeft = (-orthoSize * aspect) / 2;
        topDownCamera.orthoRight = (orthoSize * aspect) / 2;
        topDownCamera.orthoTop = orthoSize / 2;
        topDownCamera.orthoBottom = -orthoSize / 2;
    };

    updateOrtho(10);

    // Point the camera downwards (looking along -Y axis)
    topDownCamera.rotation.x = Math.PI / 2;
    topDownCamera.inputs.removeByType('FreeCameraMouseInput');

    const panningInput = new FreeCameraMousePanningInput(topDownCamera);
    topDownCamera.inputs.add(panningInput);

    // Allow moving with WASD or arrow keys (already default)
    // Limit movement to XZ plane only (FreeCamera does this by default when looking down)
    // TODO: currently only a and d keys work
    // likely moves along a wrong axis
    topDownCamera.keysUp.push(87); // W
    topDownCamera.keysDown.push(83); // S
    topDownCamera.keysLeft.push(65); // A
    topDownCamera.keysRight.push(68); // D
    topDownCamera.speed = 0.5; // Adjust keyboard movement speed

    const keyboardInput = new BABYLON.FreeCameraKeyboardMoveInput();
    keyboardInput.keysUp = [87]; // W
    keyboardInput.keysDown = [83]; // S
    keyboardInput.keysLeft = [65]; // A
    keyboardInput.keysRight = [68]; // D

    let previousTime = performance.now()

    keyboardInput.checkInputs = function () {
        if (!this.camera) return;

        const camera = this.camera as BABYLON.FreeCamera;

        const currentTime = performance.now();
        const deltaTime = (currentTime - previousTime) / 1000; // Convert ms to seconds
        previousTime = currentTime;
        const speed = camera.speed * deltaTime;

        // Create movement vectors for each direction in world space
        // @ts-ignore
        if (this._keys.includes(this.keysUp[0])) {
            // W key - Move forward (in -Z direction in world space)
            camera.position.z += speed;
        }
        // @ts-ignore
        if (this._keys.includes(this.keysDown[0])) {
            // S key - Move backward (in +Z direction in world space)
            camera.position.z -= speed;
        }
        // @ts-ignore
        if (this._keys.includes(this.keysLeft[0])) {
            // A key - Move left (in -X direction in world space)
            camera.position.x -= speed;
        }
        // @ts-ignore
        if (this._keys.includes(this.keysRight[0])) {
            // D key - Move right (in +X direction in world space)
            camera.position.x += speed;
        }
    };

    topDownCamera.inputs.removeByType('FreeCameraKeyboardMoveInput');
    topDownCamera.inputs.add(keyboardInput);
    // units per second
    topDownCamera.speed = 5;

    // Mouse Wheel Zoom
    const zoomSensitivity = 0.05; // Smaller value = slower zoom
    const minOrthoSize = 0.5; // Closest zoom (smallest area)
    const maxOrthoSize = 100; // Furthest zoom (largest area)

    scene.onPointerObservable.add((pointerInfo) => {
        if (cc.activeControlCamera != topDownCamera) return;
        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERWHEEL) {
            const event = pointerInfo.event as WheelEvent;
            let delta = -event.deltaY;

            if (delta !== 0) {
                const currentOrthoHeight = topDownCamera.orthoTop! - topDownCamera.orthoBottom!;

                // Scrolling up (negative delta) should zoom in (reduce ortho size)
                const zoomFactor = 1 - (delta * zoomSensitivity) / 100;

                let newOrthoHeight = currentOrthoHeight * zoomFactor;
                newOrthoHeight = BABYLON.Scalar.Clamp(newOrthoHeight, minOrthoSize, maxOrthoSize);
                updateOrtho(newOrthoHeight);
            }
            event.preventDefault();
        }
    });

    engine.onResizeObservable.add(() => {
        const currentOrthoHeight = topDownCamera.orthoTop! - topDownCamera.orthoBottom!;
        updateOrtho(currentOrthoHeight);
    });
}
