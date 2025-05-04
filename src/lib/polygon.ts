import * as BABYLON from '@babylonjs/core';
import { LAYER_MASK_TOPDOWN_ONLY } from './camera';

interface PolygonOptions {
	nodeDiameter?: number;
	nodeColor?: BABYLON.Color3;
	nodeSelectedColor?: BABYLON.Color3;
	nodeOpacity?: number;
	wallColor?: BABYLON.Color3;
	wallOpacity?: number;
	lineColor?: BABYLON.Color3;
	closePath?: boolean;
    nodeHeight?: number;
}

export class Polygon {
	public nodePositions: BABYLON.Vector3[] = []; // Array of world positions
	private scene: BABYLON.Scene;
	private structureNode: BABYLON.TransformNode;
	private nodes: BABYLON.Mesh[] = []; // Array of node meshes (cylinders)
	private edges: BABYLON.Mesh[] = []; // Array of connection meshes (walls)
	private _selectedNode: BABYLON.Mesh | null = null; // Holds the currently selected node mesh

	private options: Required<PolygonOptions>; // Make options required after applying defaults

	// Shared Materials
	private nodeMaterial: BABYLON.StandardMaterial;
	private wallMaterial: BABYLON.StandardMaterial;

	private _pointerObserver: BABYLON.Observer<BABYLON.PointerInfo> | null = null;
	private _keyboardObserver: BABYLON.Observer<BABYLON.KeyboardInfo> | null = null;

	constructor(scene: BABYLON.Scene, options: PolygonOptions = {}) {
		this.scene = scene;
		this.structureNode = new BABYLON.TransformNode(
			`structureParent_${BABYLON.Tools.RandomId()}`,
			scene
		);
		this.nodePositions = []; // BABYLON.Vector3 array
		this.nodes = []; // BABYLON.Mesh array (cylinders)
		this.edges = []; // BABYLON.Mesh array (lines or boxes)
		this._selectedNode = null; // Holds the currently selected node mesh

		this.options = {
			nodeDiameter: 0.2,
			nodeColor: BABYLON.Color3.Blue(),
			nodeSelectedColor: BABYLON.Color3.Yellow(),
			nodeOpacity: 1,
			wallColor: BABYLON.Color3.Red(),
			wallOpacity: 1,
			lineColor: BABYLON.Color3.Green(),
			closePath: true,
            nodeHeight: 2.5,
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

		this.wallMaterial = new BABYLON.StandardMaterial(
			`wallMat_${this.structureNode.uniqueId}`,
			scene
		);
		this.wallMaterial.diffuseColor = this.options.wallColor;
        this.wallMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        this.wallMaterial.specularPower = 32;

		this._addInteractionObservers();
		this._addKeyboardObserver();
	}

	addPoint(position: BABYLON.Vector3) {
		const index = this.nodePositions.length;
		this.nodePositions.push(position);
		const node = this._createNodeMesh(position, index);
		this.nodes.push(node);
		console.log(`Added node at index ${index}. Total nodes: ${this.nodes.length}`);
		this.buildEdges();
	}

	deleteSelectedNode(): boolean {
		if (!this._selectedNode) {
			console.log('No node selected for deletion.');
			return false;
		}

		const minNodesRequired = this.options.closePath ? 3 : 2; // Need this many *before* deletion
		if (this.nodes.length < minNodesRequired) {
			// TODO: delete polygon
			console.log(
				`Cannot delete node: At least ${minNodesRequired} nodes required to maintain structure.`
			);
			this._deselectNode(); // Still deselect if deletion is blocked
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
		this._deselectNode(); // Dispose highlight, clear selection

		this.nodePositions.splice(indexToDelete, 1);
		this.nodes.splice(indexToDelete, 1);
		nodeToDelete?.dispose(); // Dispose the mesh

		// Update indices of subsequent nodes
		for (let i = indexToDelete; i < this.nodes.length; i++) {
			if (this.nodes[i]?.metadata) {
				this.nodes[i].metadata!.index = i;
			} else {
				console.warn(`Node at new index ${i} missing or metadata missing after deletion.`);
			}
		}

		this.buildEdges();
		console.log(`Node ${indexToDelete} deleted. Total nodes remaining: ${this.nodes.length}`);
		return true;
	}

	buildEdges() {
		// Dispose existing edges
		this.edges.forEach((edge) => edge?.dispose());
		this.edges = [];

		if (this.nodePositions.length < 2) return; // Need at least 2 points

		const numPoints = this.nodePositions.length;
		for (let i = 0; i < numPoints; i++) {
			const p1 = this.nodePositions[i];
			let p2 = null;
			let nextIndex = -1;

			if (i < numPoints - 1) {
				// Standard edge i -> i+1
				p2 = this.nodePositions[i + 1];
				nextIndex = i + 1;
			} else if (this.options.closePath && numPoints > 1) {
				// Closing edge last -> 0
				p2 = this.nodePositions[0];
				nextIndex = 0;
			} else {
				continue; // Last point, not closing path
			}

			if (!p1 || !p2) {
				// Should not happen with the logic above, but safety check
				console.warn(`Missing point data for edge index ${i}. Skipping.`);
				continue;
			}

			const edgeName = `edge_${i}_${nextIndex}_${this.structureNode.uniqueId}`;
			let edgeMesh = null;

            const path = [p1.clone(), p2.clone()]

			const direction = p2.subtract(p1);
			const distance = direction.length();
			if (distance > 1e-6) {
				// Avoid zero-size walls
				const wall = BABYLON.MeshBuilder.CreateTube(
					edgeName,
					{
                        path,
                        radius: this.options.nodeDiameter / 2 * 0.5,
                        sideOrientation: BABYLON.Mesh.DOUBLESIDE,
                        updatable: false
					},
					this.scene
				);
				wall.material = this.wallMaterial;
				wall.parent = this.structureNode;
				wall.metadata = { builder: this, type: 'edge', pointsIndex: [i, nextIndex] };
				wall.isPickable = true;
				wall.visibility = this.options.wallOpacity;
                wall.layerMask = LAYER_MASK_TOPDOWN_ONLY;
				edgeMesh = wall;
			} else {
				console.warn(`Points for edge index ${i} are coincident. Skipping wall.`);
			}

			if (edgeMesh) {
				this.edges.push(edgeMesh);
			}
		}
	}

	getParentNode(): BABYLON.TransformNode {
		return this.structureNode;
	}

	dispose() {
		console.log(`Disposing builder instance:`, this);
		this.scene?.onPointerObservable.remove(this._pointerObserver);
		this.scene?.onKeyboardObservable.remove(this._keyboardObserver);
		this._pointerObserver = null;
		this._keyboardObserver = null;

		this._deselectNode(); // Clean up potential highlight material

		// Dispose meshes (check _highlightMat existence during loop for robustness)
		this.nodes.forEach((node) => {
			if (node && !node.isDisposed()) {
				node._highlightMat?.dispose(); // Ensure highlight mat is gone
				node.dispose();
			}
		});
		this.edges.forEach((edge) => edge?.dispose());
		this.nodes = [];
		this.edges = [];

		// Dispose shared materials and parent node
		this.nodeMaterial?.dispose();
		this.wallMaterial?.dispose();
		this.structureNode?.dispose();
		this.nodeMaterial = null as any;
		this.wallMaterial = null as any;
		this.structureNode = null as any;

		this.nodePositions = [];
		this.scene = null as any;
	}

	getNodesInArea(point1: BABYLON.Vector3, point2: BABYLON.Vector3) {
		const minPoint = BABYLON.Vector3.Minimize(point1, point2);
		const maxPoint = BABYLON.Vector3.Maximize(point1, point2);

		return this.nodes.filter((node) => {
			if (!node || node.isDisposed()) return false;
			const pos = node.position; // Position relative to structureNode
			return (
				pos.x >= minPoint.x &&
				pos.x <= maxPoint.x &&
				pos.y >= minPoint.y &&
				pos.y <= maxPoint.y &&
				pos.z >= minPoint.z &&
				pos.z <= maxPoint.z
			);
		});
	}

	_createNodeMesh(position: BABYLON.Vector3, index: number): BABYLON.Mesh {
		const node = BABYLON.MeshBuilder.CreateSphere(
			`node_${index}_${this.structureNode.uniqueId}`,
			{
				diameter: this.options.nodeDiameter,
			},
			this.scene
		);
		node.position = position.clone(); // Use clone defensively
		node.material = this.nodeMaterial;
		node.parent = this.structureNode;
		node.isPickable = true;
		node.metadata = { builder: this, type: 'node', index: index };
		node.visibility = this.options.nodeOpacity;
        node.layerMask = LAYER_MASK_TOPDOWN_ONLY;

		const dragBehavior = new BABYLON.PointerDragBehavior({
			dragPlaneNormal: new BABYLON.Vector3(0, 1, 0)
		});
		dragBehavior.onDragObservable.add(() => {
			const pointIndex = node.metadata?.index;
			// Check index validity and if the node still exists at that index
			if (
				pointIndex !== undefined &&
				this.nodePositions[pointIndex] &&
				this.nodes[pointIndex] === node
			) {
				this.nodePositions[pointIndex].copyFrom(node.position);
				this.buildEdges(); // Update edges during drag
			} else {
				console.warn('Dragged node metadata index mismatch or invalid during drag.', {
					node,
					pointIndex,
					nodePositionsLength: this.nodePositions.length
				});
			}
		});
		dragBehavior.onDragEndObservable.add(() => this.buildEdges());
		node.addBehavior(dragBehavior);
		node._dragBehavior = dragBehavior; // Store reference if needed later
		return node;
	}

	_selectNode(node: BABYLON.Mesh) {
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

		node._originalMaterial = node.material; // Store original
		// Create and apply highlight material
		const highlightMat = new BABYLON.StandardMaterial(
			`nodeHighlightMat_${node.uniqueId}`,
			this.scene
		);
		highlightMat.diffuseColor = this.options.nodeColor; // Use original base color
		highlightMat.emissiveColor = this.options.nodeSelectedColor; // Add highlight glow
		if (node._originalMaterial) {
			highlightMat.alpha = node._originalMaterial.alpha;
		}
		node.material = highlightMat;
		node._highlightMat = highlightMat; // Store ref for disposal
	}

	_deselectNode() {
		const node = this._selectedNode;
		if (!node) return;

		console.log(`Deselecting node ${node.metadata?.index}.`); // Use optional chaining for index safety

		node._highlightMat?.dispose(); // Dispose the temp highlight material
		if (node._originalMaterial && node.material !== node._originalMaterial) {
			// Restore original only if it exists and wasn't already restored
			node.material = node._originalMaterial;
		} else if (!node._originalMaterial && node.material !== this.nodeMaterial) {
			// Fallback if original was lost
			node.material = this.nodeMaterial;
			console.warn(
				'Deselecting node, _originalMaterial reference was missing. Re-assigned shared nodeMaterial.',
				node
			);
		}

		// Clean up temporary properties from the node object
		delete node._originalMaterial;
		delete node._highlightMat;

		this._selectedNode = null; // Clear selection reference
	}

	_addInteractionObservers() {
		this._pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
			if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;

			const pickedMesh = pointerInfo.pickInfo?.pickedMesh;

			// Clicked on nothing or something not part of this builder? Deselect.
			if (!pickedMesh || pickedMesh.metadata?.builder !== this) {
				this._deselectNode();
				return;
			}

			const metadata = pickedMesh.metadata;

			if (metadata.type === 'node') {
				this._selectNode(pickedMesh as BABYLON.Mesh);
			} else if (metadata.type === 'edge' && pointerInfo.pickInfo.pickedPoint) {
				console.log('Edge (wall) picked.');
				this._deselectNode(); // Deselect node before adding new one

				const [index1, index2] = metadata.pointsIndex;
				const clickedPosition = pointerInfo.pickInfo.pickedPoint.clone(); // Use clone
				clickedPosition._y = this.options.nodeHeight;

				// Determine insertion index (handle wrap-around edge)
				let insertionIndex;
				if (this.options.closePath && index1 === this.nodePositions.length - 1 && index2 === 0) {
					insertionIndex = this.nodePositions.length; // Insert at the end
				} else if (index2 === index1 + 1) {
					insertionIndex = index1 + 1; // Insert between index1 and index2
				} else {
					console.warn('Clicked edge indices unexpected.', {
						metadata,
						nodePositionsSize: this.nodePositions.length
					});
					return; // Don't insert if indices are wrong
				}

				// Insert new point data and mesh
				this.nodePositions.splice(insertionIndex, 0, clickedPosition);
				// Create node with temporary index, will be fixed below
				const newNode = this._createNodeMesh(clickedPosition, -1);
				this.nodes.splice(insertionIndex, 0, newNode);

				// Update indices for all nodes from insertion point onwards
				for (let i = insertionIndex; i < this.nodes.length; i++) {
					if (this.nodes[i]?.metadata) {
						// Safety check
						this.nodes[i].metadata!.index = i;
					}
				}

				this.buildEdges();
				console.log(
					`Inserted new node at index ${insertionIndex}. Total nodes: ${this.nodes.length}`
				);
				// pointerInfo.event.stopPropagation(); // Prevent other actions
			} else {
				// Picked something else from this builder (e.g., a line, or a wall when createWalls=false)
				console.log('Picked non-interactive builder mesh. Deselecting node.');
				this._deselectNode();
			}
		});
	}

	_addKeyboardObserver() {
		this._keyboardObserver = this.scene.onKeyboardObservable.add((kbInfo) => {
			if (
				this._selectedNode &&
				kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN &&
				(kbInfo.event.key === 'Delete' || kbInfo.event.key === 'Backspace')
			) {
				console.log('Delete/Backspace pressed. Attempting delete.');
				if (this.deleteSelectedNode()) {
					// Only prevent default if deletion succeeded
					kbInfo.event.preventDefault();
				}
			}
		});
	}
}
