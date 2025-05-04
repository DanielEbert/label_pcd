export enum DrawMode {
    Draw = "DRAW",
    Erase = "ERASE",
};

export class SimState {
    public drawMode: DrawMode = $state(DrawMode.Draw);
};
