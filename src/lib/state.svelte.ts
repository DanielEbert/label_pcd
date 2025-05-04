export enum DrawMode {
    Draw = "DRAW",
    Erase = "ERASE",
    Poly = "POLY",
};

export class SimState {
    public drawMode: DrawMode = $state(DrawMode.Draw);
};
