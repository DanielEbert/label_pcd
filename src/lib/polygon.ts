import * as BABYLON from '@babylonjs/core';
import { LAYER_MASK_TOPDOWN_ONLY } from './camera';
import type { PolygonManager } from './polygon_manager';

interface PolygonOptions {
    nodeDiameter?: number;
    nodeColor?: BABYLON.Color3;
    nodeSelectedColor?: BABYLON.Color3;
    nodeOpacity?: number;
    wallColor?: BABYLON.Color3;
    wallOpacity?: number;
    closePath?: boolean;
    nodeHeight?: number;
    wallRadiusRatio?: number; // Ratio of wall radius to node radius
}

export class Polygon {
    public nodePositions: BABYLON.Vector3[] = []; // Array of world positions
    private structureNode: BABYLON.TransformNode;
    private nodes: BABYLON.Mesh[] = []; // Array of node meshes (spheres)
    private edges: BABYLON.Mesh[] = []; // Array of connection meshes (walls/tubes)
    private _selectedNode: BABYLON.Mesh | null = null; // Holds the currently selected node mesh

    private options: Required<PolygonOptions>; // Make options required after applying defaults

    // Shared Materials
    private nodeMaterial: BABYLON.StandardMaterial;
    private wallMaterial: BABYLON.StandardMaterial;
    private highlightMaterial: BABYLON.StandardMaterial | null = null; // Reuse highlight material

    private _pointerObserver: BABYLON.Observer<BABYLON.PointerInfo> | null = null;
    private _keyboardObserver: BABYLON.Observer<BABYLON.KeyboardInfo> | null = null;

    private _isDisposed = false;

    constructor(private scene: BABYLON.Scene, private polygonManager: PolygonManager, options: PolygonOptions = {}) {
        this.structureNode = new BABYLON.TransformNode(
            `structureParent_${BABYLON.Tools.RandomId()}`,
            scene
        );
        this.nodePositions = [];
        this.nodes = [];
        this.edges = [];
        this._selectedNode = null;

        this.options = {
            nodeDiameter: 0.2,
            nodeColor: BABYLON.Color3.Blue(),
            nodeSelectedColor: BABYLON.Color3.Yellow(),
            nodeOpacity: 1,
            wallColor: BABYLON.Color3.Red(),
            wallOpacity: 1,
            closePath: true,
            nodeHeight: 2.5,
            wallRadiusRatio: 0.25,
            ...options
        };

        // Shared Materials
        this.nodeMaterial = new BABYLON.StandardMaterial(
            `nodeMat_${this.structureNode.uniqueId}`,
            scene
        );
        this.nodeMaterial.diffuseColor = this.options.nodeColor;
        this.nodeMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        this.nodeMaterial.specularPower = 32;
        this.nodeMaterial.alpha = this.options.nodeOpacity;

        this.wallMaterial = new BABYLON.StandardMaterial(
            `wallMat_${this.structureNode.uniqueId}`,
            scene
        );
        this.wallMaterial.diffuseColor = this.options.wallColor;
        this.wallMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        this.wallMaterial.specularPower = 32;
        this.wallMaterial.alpha = this.options.wallOpacity;

        this._addInteractionObservers();
        this._addKeyboardObserver();
    }

    addPoint(position: BABYLON.Vector3) {
        if (this._isDisposed) return;
        position.y = this.options.nodeHeight;
        const index = this.nodePositions.length;
        this.nodePositions.push(position.clone());
        const node = this._createNodeMesh(position, index);
        this.nodes.push(node);
        console.log(`Added node at index ${index}. Total nodes: ${this.nodes.length}`);
        this._rebuildEdges();
    }

    deleteSelectedNode(): boolean {
        if (this._isDisposed) return false;
        if (!this._selectedNode) {
            console.log('No node selected for deletion.');
            return false;
        }

        const minNodesAfterDeletion = this.options.closePath ? 3 : 2;
        if (this.nodes.length <= minNodesAfterDeletion) {
            // Special case: if deleting brings us below the minimum for a closed path,
            // maybe just delete the whole polygon? Or prevent deletion?
            // Current logic prevents deletion if it would result in < min required nodes.
            const nodeType = this.options.closePath ? 'closed polygon' : 'path';
            console.log(
                `Cannot delete node: At least ${minNodesAfterDeletion} nodes required to maintain ${nodeType}. Current: ${this.nodes.length}`
            );
            this._deselectNode();
            return false;
        }

        const nodeToDelete = this._selectedNode;
        const indexToDelete = nodeToDelete.metadata?.index;

        if (
            indexToDelete === undefined ||
            indexToDelete < 0 ||
            indexToDelete >= this.nodes.length ||
            this.nodes[indexToDelete] !== nodeToDelete
        ) {
            console.error('Selected node index mismatch or invalid. Cannot delete.', {
                nodeToDelete,
                indexToDelete,
                nodesArraySize: this.nodes.length
            });
            this._deselectNode();
            return false;
        }

        console.log(`Deleting node at index ${indexToDelete}.`);
        this._deselectNode();

        // Remove
        this.nodePositions.splice(indexToDelete, 1);
        this.nodes.splice(indexToDelete, 1);
        nodeToDelete?.dispose(false, true);

        // Update indices of subsequent nodes
        for (let i = indexToDelete; i < this.nodes.length; i++) {
            if (this.nodes[i]?.metadata) {
                this.nodes[i].metadata!.index = i;
                // Also update node name for clarity
                this.nodes[i].name = `node_${i}_${this.structureNode.uniqueId}`;
            } else {
                console.warn(`Node at new index ${i} missing or metadata missing after deletion.`);
            }
        }

        this._rebuildEdges();
        console.log(`Node ${indexToDelete} deleted. Total nodes remaining: ${this.nodes.length}`);
        return true;
    }

    // --- Edge Management ---

    // Disposes old edges and creates new, updatable edge meshes.
    // Call this when the number or connectivity of nodes changes.
    private _rebuildEdges() {
        if (this._isDisposed) return;
        // Dispose existing edges
        this.edges.forEach((edge) => edge?.dispose());
        this.edges = [];

        if (this.nodePositions.length < 2) return;

        const numPoints = this.nodePositions.length;
        const wallRadius = (this.options.nodeDiameter / 2) * this.options.wallRadiusRatio;

        for (let i = 0; i < numPoints; i++) {
            const p1 = this.nodePositions[i];
            let p2: BABYLON.Vector3 | null = null;
            let nextIndex = -1;

            // Determine the endpoints for this edge
            if (i < numPoints - 1) {
                // Standard edge i -> i+1
                p2 = this.nodePositions[i + 1];
                nextIndex = i + 1;
            } else if (this.options.closePath && numPoints >= 2) { // Need >= 2 for closing edge
                // Closing edge last -> 0
                p2 = this.nodePositions[0];
                nextIndex = 0;
            } else {
                continue; // Last point, not closing path, or not enough points to close
            }

            if (!p1 || !p2) {
                console.warn(`Missing point data for edge between index ${i} and ${nextIndex}. Skipping.`);
                continue;
            }

            // Avoid zero-length edges if points are coincident
            if (BABYLON.Vector3.DistanceSquared(p1, p2) < 1e-6) {
                console.warn(`Points for edge index ${i} are coincident. Skipping wall.`);
                // Current update logic assumes edges[i] exists if an edge should be there.
                // Let's just not create the mesh for now. This might break _updateEdges if counts mismatch.
                continue;
            }

            const edgeName = `edge_${i}_${nextIndex}_${this.structureNode.uniqueId}`;
            const path = [p1, p2];

            const edgeMesh = BABYLON.MeshBuilder.CreateTube(
                edgeName,
                {
                    path: path,
                    radius: wallRadius,
                    sideOrientation: BABYLON.Mesh.DOUBLESIDE,
                    updatable: true,
                    cap: BABYLON.Mesh.CAP_ALL
                },
                this.scene
            );

            edgeMesh.material = this.wallMaterial;
            edgeMesh.parent = this.structureNode;
            edgeMesh.metadata = { builder: this, type: 'edge', pointsIndex: [i, nextIndex] };
            edgeMesh.isPickable = true;
            edgeMesh.layerMask = LAYER_MASK_TOPDOWN_ONLY;
            this.edges.push(edgeMesh);
        }
        console.log(`Rebuilt ${this.edges.length} edges.`);
    }

    // Updates the geometry of existing edge meshes based on current node positions.
    private _updateEdges() {
        if (this._isDisposed || this.nodePositions.length < 2) return;

        const numPoints = this.nodePositions.length;
        const expectedEdgeCount = this.options.closePath ? numPoints : numPoints - 1;

        if (this.edges.length !== expectedEdgeCount) {
            console.warn(`Edge count mismatch (${this.edges.length} vs expected ${expectedEdgeCount}). Rebuilding edges.`);
            this._rebuildEdges();
            return;
        }

        const wallRadius = (this.options.nodeDiameter / 2) * this.options.wallRadiusRatio;

        for (let i = 0; i < expectedEdgeCount; i++) {
            const edgeMesh = this.edges[i];
            if (!edgeMesh || edgeMesh.isDisposed()) {
                console.warn(`Edge mesh at index ${i} is missing or disposed during update. Rebuilding.`);
                this._rebuildEdges();
                return;
            }

            const p1 = this.nodePositions[i];
            const nextIndex = (i + 1) % numPoints;
            const p2 = this.nodePositions[nextIndex];

            if (!p1 || !p2) {
                console.warn(`Missing point data for edge update at index ${i}. Skipping update for this edge.`);
                continue;
            }

            // Avoid updating if points are coincident (CreateTube update might fail)
            if (BABYLON.Vector3.DistanceSquared(p1, p2) < 1e-6) {
                // update might still have issues
                edgeMesh.isVisible = false;
                // Skip the geometry update call
                continue;
            } else {
                // Ensure visible if points separate again
                edgeMesh.isVisible = true;
            }


            const path = [p1, p2];

            BABYLON.MeshBuilder.CreateTube(
                'tube_update',
                {
                    path: path,
                    radius: wallRadius,
                    instance: edgeMesh, // Pass the existing mesh instance to update
                }
            );
        }
    }

    // --- Node Management & Interaction ---

    getParentNode(): BABYLON.TransformNode {
        return this.structureNode;
    }

    dispose() {
        if (this._isDisposed) return;
        this._isDisposed = true;

        console.log(`Disposing polygon builder instance:`, this.structureNode.name);
        this.scene?.onPointerObservable.remove(this._pointerObserver);
        this.scene?.onKeyboardObservable.remove(this._keyboardObserver);
        this._pointerObserver = null;
        this._keyboardObserver = null;

        this._deselectNode();

        // Dispose meshes
        this.nodes.forEach((node) => node?.dispose(false, true));
        this.edges.forEach((edge) => edge?.dispose());
        this.nodes = [];
        this.edges = [];

        // Dispose shared materials and parent node
        this.nodeMaterial?.dispose();
        this.wallMaterial?.dispose();
        this.highlightMaterial?.dispose();
        this.structureNode?.dispose();

        this.nodeMaterial = null as any;
        this.wallMaterial = null as any;
        this.highlightMaterial = null;
        this.structureNode = null as any;
        this.nodePositions = [];
        this.scene = null as any;
    }

    getNodesInArea(point1: BABYLON.Vector3, point2: BABYLON.Vector3) {
        if (this._isDisposed) return [];
        // Assumes selection box is axis-aligned in world space
        const minPoint = BABYLON.Vector3.Minimize(point1, point2);
        const maxPoint = BABYLON.Vector3.Maximize(point1, point2);

        return this.nodes.filter((node) => {
            if (!node || node.isDisposed()) return false;
            // Use absolute position for world-space comparison
            const absPos = node.getAbsolutePosition();
            return (
                absPos.x >= minPoint.x &&
                absPos.x <= maxPoint.x &&
                // absPos.y >= minPoint.y && // Usually ignore Y for top-down selection
                // absPos.y <= maxPoint.y &&
                absPos.z >= minPoint.z &&
                absPos.z <= maxPoint.z
            );
        });
    }

    _createNodeMesh(position: BABYLON.Vector3, index: number): BABYLON.Mesh {
        const node = BABYLON.MeshBuilder.CreateSphere(
            `node_${index}_${this.structureNode.uniqueId}`,
            {
                diameter: this.options.nodeDiameter,
                segments: 16  // sphere smoothness
            },
            this.scene
        );
        node.position = position.clone();
        node.material = this.nodeMaterial;
        node.parent = this.structureNode;
        node.isPickable = true;
        node.metadata = { builder: this, type: 'node', index: index };
        node.layerMask = LAYER_MASK_TOPDOWN_ONLY;

        const dragBehavior = new BABYLON.PointerDragBehavior({
            dragPlaneNormal: new BABYLON.Vector3(0, 1, 0) // Drag on XZ plane
        });

        // Drag relative to world/plane normal
        dragBehavior.useObjectOrientationForDragging = false;

        dragBehavior.onDragObservable.add((_) => {
            if (this._isDisposed) return;
            const pointIndex = node.metadata?.index;
            if (
                pointIndex !== undefined &&
                pointIndex >= 0 && pointIndex < this.nodePositions.length &&
                this.nodePositions[pointIndex] &&
                this.nodes[pointIndex] === node
            ) {
                node.position.y = this.options.nodeHeight;
                this.nodePositions[pointIndex].copyFrom(node.position);
                this._updateEdges();
            } else {
                console.warn('Dragged node metadata index mismatch or invalid during drag.', {
                    nodeName: node.name,
                    pointIndex,
                    nodePositionsLength: this.nodePositions.length
                });
            }
        });

        dragBehavior.onDragEndObservable.add(() => {
            if (this._isDisposed) return;
            // Ensure final position is snapped and edges updated
            node.position.y = this.options.nodeHeight;
            const pointIndex = node.metadata?.index;
            if (pointIndex !== undefined && this.nodePositions[pointIndex]) {
                this.nodePositions[pointIndex].copyFrom(node.position);
            }
            // Ensure edges are perfectly aligned at the end
            this._updateEdges();
        });

        node.addBehavior(dragBehavior);
        node.metadata._dragBehavior = dragBehavior;
        return node;
    }

    // --- Selection ---

    _selectNode(node: BABYLON.Mesh) {
        if (this._isDisposed) return;
        if (
            !node ||
            node.isDisposed() ||
            node.metadata?.builder !== this ||
            node.metadata?.type !== 'node'
        ) {
            console.warn('Attempted to select an invalid or non-builder node.', node);
            this._deselectNode();
            return;
        }
        if (this._selectedNode === node) return; // Already selected

        this._deselectNode(); // Deselect previous first

        this._selectedNode = node;
        console.log(`Node ${node.metadata.index} selected.`);

        // Create highlight material only if it doesn't exist
        if (!this.highlightMaterial) {
            this.highlightMaterial = new BABYLON.StandardMaterial(
                `nodeHighlightMat_${this.structureNode.uniqueId}`, // Use shared name
                this.scene
            );
            this.highlightMaterial.emissiveColor = this.options.nodeSelectedColor;
            this.highlightMaterial.diffuseColor = this.options.nodeColor; // Keep base color
            this.highlightMaterial.specularColor = new BABYLON.Color3(0, 0, 0); // Less shiny when selected
            this.highlightMaterial.alpha = this.options.nodeOpacity; // Match opacity
        }

        node.metadata._originalMaterial = node.material; // Store original
        node.material = this.highlightMaterial;
    }

    _deselectNode() {
        if (this._isDisposed) return;
        const node = this._selectedNode;
        if (!node || node.isDisposed()) {
            this._selectedNode = null; // Ensure selection is cleared if node was disposed externally
            return;
        }

        console.log(`Deselecting node ${node.metadata?.index}.`);

        // Restore original material only if it exists and is different
        if (node.metadata?._originalMaterial && node.material !== node.metadata._originalMaterial) {
            node.material = node.metadata._originalMaterial;
        } else if (!node.metadata?._originalMaterial && node.material !== this.nodeMaterial) {
            // Fallback if original was lost somehow
            node.material = this.nodeMaterial;
            console.warn(
                'Deselecting node, _originalMaterial reference was missing or invalid. Re-assigned shared nodeMaterial.',
                node.name
            );
        }

        // Clean up temporary property from the node metadata
        if (node.metadata) {
            delete node.metadata._originalMaterial;
        }

        this._selectedNode = null;
    }

    // --- Observers ---

    _addInteractionObservers() {
        if (this._isDisposed) return;
        this._pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
            if (this._isDisposed) return;
            // Only react on pointer down
            if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
            // Ignore if drag behavior is already active (prevents deselect on drag start)
            if (this._selectedNode && this._selectedNode.metadata?._dragBehavior?.dragging) {
                return;
            }

            const pickedMesh = pointerInfo.pickInfo?.pickedMesh;

            // Clicked on nothing or something not related to this builder instance? Deselect.
            if (!pickedMesh || pickedMesh.metadata?.builder !== this) {
                this._deselectNode();
                return;
            }

            const metadata = pickedMesh.metadata;

            if (metadata.type === 'node') {
                this._selectNode(pickedMesh as BABYLON.Mesh);
            }
            else if (metadata.type === 'edge' && pointerInfo.pickInfo.pickedPoint) {
                console.log('Edge (wall) picked.');
                this._deselectNode(); // Deselect any node before adding new one

                const [index1, index2] = metadata.pointsIndex;
                const clickedPosition = pointerInfo.pickInfo.pickedPoint.clone();
                clickedPosition.y = this.options.nodeHeight;

                // Determine insertion index: always insert *after* index1
                // If clicking the closing edge (last_index -> 0), insert at the end.
                let insertionIndex;
                if (this.options.closePath && index1 === this.nodePositions.length - 1 && index2 === 0) {
                    insertionIndex = this.nodePositions.length;
                } else {
                    insertionIndex = index1 + 1;
                }

                this.nodePositions.splice(insertionIndex, 0, clickedPosition); // clickedPosition is already a clone

                // Create the new node mesh. -1 is temp index  (will get correct index after loop).
                const newNode = this._createNodeMesh(clickedPosition, -1);
                this.nodes.splice(insertionIndex, 0, newNode);

                // Update indices for all nodes from insertion point onwards
                for (let i = insertionIndex; i < this.nodes.length; i++) {
                    if (this.nodes[i]?.metadata) {
                        this.nodes[i].metadata!.index = i;
                        this.nodes[i].name = `node_${i}_${this.structureNode.uniqueId}`;
                    }
                }

                this._rebuildEdges();
                console.log(
                    `Inserted new node at index ${insertionIndex}. Total nodes: ${this.nodes.length}`
                );
                this._selectNode(newNode);

            } else {
                console.log('Picked non-interactive builder mesh part. Deselecting node.');
                this._deselectNode();
            }
        });
    }

    _addKeyboardObserver() {
        if (this._isDisposed) return;
        this._keyboardObserver = this.scene.onKeyboardObservable.add((kbInfo) => {
            if (this._isDisposed || kbInfo.type !== BABYLON.KeyboardEventTypes.KEYDOWN
                || !this._selectedNode || this._selectedNode.isDisposed()
                || this._selectedNode.metadata?.builder !== this
            ) return;

            const key = kbInfo.event.key;
            const shiftPressed = kbInfo.event.shiftKey;

            if (shiftPressed && (key === 'Delete' || key === 'Backspace')
            ) {
                console.log(`Shift+Delete pressed with node ${this._selectedNode.metadata.index} selected. Deleting entire polygon.`);
                this.dispose();
                this.polygonManager.onPolygonDeleted(this)
                kbInfo.event.preventDefault();
            }

            if (
                !shiftPressed && (kbInfo.event.key === 'Delete' || kbInfo.event.key === 'Backspace')
            ) {
                console.log('Delete/Backspace pressed. Attempting delete.');
                if (this.deleteSelectedNode()) {
                    kbInfo.event.preventDefault();
                }
            }

            if (key === 'Escape') {
                this._deselectNode();
                kbInfo.event.preventDefault();
            }

            if (key === 'Enter') {
                // paint all points, also add history
                // probably delete polygon after paint
                this.polygonManager.onColorPolygon(this)
            }
        });
    }
}
