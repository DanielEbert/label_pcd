import { PointCloudManager } from './pointcloud'

export class HistoryManager {
    private history: number[][] = [];
    private currentStateIndex = -1;
    private maxHistory = 20;

    constructor(public pointCloudManager: PointCloudManager) {
        this.saveState();
    }

    public saveState(): void {
        const currentClasses = this.pointCloudManager.pcsClass!;
        if (!currentClasses) return;
        if (this.currentStateIndex < this.history.length - 1) this.history = this.history.slice(0, this.currentStateIndex + 1);
        this.history.push([...currentClasses]);

        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } 

        this.currentStateIndex = this.history.length - 1;
    }

    public undo(): void {
        if (this.currentStateIndex <= 0) return;
        this.currentStateIndex--;
        this.applyState(this.currentStateIndex);
    }

    public redo(): void {
        if (this.currentStateIndex >= this.history.length - 1) return;
        this.currentStateIndex++;
        this.applyState(this.currentStateIndex);
    }

    private applyState(stateIndex: number): void {
        if (stateIndex < 0 || stateIndex >= this.history.length) return;
        this.pointCloudManager.setParticleClasses(this.history[stateIndex]);
    }
}
