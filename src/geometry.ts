// 新模块 —— geometry模块 封装 图形的 顶点数据：位置、颜色和纹理坐标
export class QuadGeometry {
    public positions: number[];
    public colors: number[];
    public texCoords: number[];

    constructor() {
        this.positions = [
            -0.5, -0.5, // x, y
            0.5, -0.5,
            -0.5, 0.5,
            -0.5, 0.5,
            0.5, 0.5,
            0.5, -0.5
        ];

        this.colors = [
            1.0, 0.0, 1.0,  // r g b 
            0.0, 1.0, 1.0,  // r g b 
            0.0, 1.0, 1.0,  // r g b 
            1.0, 0.0, 0.0,  // r g b 
            0.0, 1.0, 0.0,  // r g b 
            0.0, 0.0, 1.0,  // r g b 
        ];

        this.texCoords = [
            0.0, 1.0, // u, v
            1.0, 1.0,
            0.0, 0.0,
            0.0, 0.0,
            1.0, 0.0,
            1.0, 1.0
        ]
    }
}