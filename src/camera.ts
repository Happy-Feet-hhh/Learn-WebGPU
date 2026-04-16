import { mat4, type Mat4 } from 'wgpu-matrix'

export class Camera {
    private projection!: Mat4;
    private view!: Mat4

    public projectionViewMatrix: Mat4;

    constructor(public width: number, public height: number) {
        this.projectionViewMatrix = mat4.create();
    }

    public update() {

        this.projection = mat4.ortho(0, this.width, this.height, 0, -1, 1);
        this.view = mat4.lookAt([0, 0, 1], [0, 0, 0], [0, 1, 0]);

        mat4.multiply(this.projection, this.view, this.projectionViewMatrix);
    }
}
