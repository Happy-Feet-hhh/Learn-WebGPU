// 从shader源代码引入
import shaderSource from "./shaders/shader.wgsl?raw";

class Renderer {
  private context!: GPUCanvasContext;
  private device!: GPUDevice;
  private pipeline!: GPURenderPipeline;
  // 新增 顶点位置缓冲区
  private positionBuffer!: GPUBuffer;
  // 新增 顶点颜色缓冲区
  private colorBuffer!: GPUBuffer;

  constructor() {}
  
  public async initialize(): Promise<void> {
    if (!navigator.gpu) {
      alert("WebGPU不受支持!");
      return;
    }

    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.context = canvas.getContext('webgpu')!;
    
    if(!this.context) {
      alert("当前画布不支持WebGPU上下文!");
      return;
    }

    const adapter = await navigator.gpu.requestAdapter()!;

    if (!adapter) {
      alert("无法找到合适的适配器(显卡)")
    }

    const info = adapter?.info;
    console.log("显卡的厂商:", info?.vendor);
    console.log("显卡的架构:", info?.architecture);

    this.device = await adapter?.requestDevice()!;
    
    
    this.context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
    });

    // 新增 在CPU侧定义好顶点的相关数据 位置 颜色
    // 使用新的 私有方法 this.createBuffer()
    this.positionBuffer = this.createBuffer(new Float32Array([
      -0.5, -0.5, // x, y 共六个顶点位置
      0.5, -0.5,
      -0.5, 0.5,
      -0.5, 0.5,
      0.5, 0.5,
      0.5, -0.5
    ]))

    this.colorBuffer = this.createBuffer(new Float32Array([
      1.0, 0.0, 1.0,  // r g b 第一个顶点的颜色
      0.0, 1.0, 1.0,
      0.0, 1.0, 1.0,
      1.0, 0.0, 0.0,  // r g b 第四个顶点的颜色
      0.0, 1.0, 0.0,
      0.0, 0.0, 1.0,
    ]))

    // 新增，准备shader module 着色器模块
    this.prepareModel();
  }

  // 新增 私有方法 createBuffer() 用于创建各种缓冲区
  // 传入参数是一个 f32 数组
  private createBuffer(data: Float32Array): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: data.byteLength,  // 为啥是byteLength而不是length
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });

    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();

    return buffer;
  }

  private prepareModel(): void {
    const shaderModule = this.device.createShaderModule({
      code: shaderSource
    });

    // 虽然我们创建了顶点缓冲区，但是还需要创建布局才能应用
    // 之前的数据我们人脑自己划分了数据的界限，比如一行算一个顶点位置，两个f32数据
    // 但是没有手动设置到渲染管线中
    const positionBufferLayout: GPUVertexBufferLayout = {
      arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT, // 2 个浮点数 × 每个浮点数 4 字节
      attributes: [
        {
          shaderLocation: 0,  // 这个与vertex shader代码里的 @location(0)对应
          offset: 0,
          format: "float32x2" // 为什么arrayStride定义了这里还要定义
        }
      ],
      stepMode: "vertex"
    };

    const colorBufferLayout: GPUVertexBufferLayout = {
      arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
      attributes: [
        {
          shaderLocation: 1,  // 对应vertex shader的@location(1)
          offset: 0,
          format: "float32x3"
        }
      ],
      stepMode: "vertex"
    };

    const vertexState: GPUVertexState = {
      module: shaderModule,
      entryPoint: "vertexMain",
      buffers: [
        // 新增 将缓冲区布局插入
        positionBufferLayout,
        colorBufferLayout
      ]
    };

    const fragmentState: GPUFragmentState = {
      module: shaderModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: navigator.gpu.getPreferredCanvasFormat()
        }
      ]
    };

    // 注意：WebGPU中不需要自己创建RenderPipeline的Layout, 因为可以auto
    // Render Pipeline Layout里保存了 bind_group相关的信息
    this.pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: vertexState,
      fragment: fragmentState,
      primitive: {
        topology: "triangle-list"
      }
    });
  }

  public draw() {
    const commandEncoder = this.device.createCommandEncoder();
    const rendePassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          clearValue: { r: 0.8, g: 0.8, b: 0.8, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
          view: this.context.getCurrentTexture().createView()
        }
      ]
    };

    const passEncoder = commandEncoder.beginRenderPass(rendePassDescriptor);
    // DRAW HERE
    passEncoder.setPipeline(this.pipeline);
    // 新增 在renderpass解码器中设置GPU缓冲区
    // 因为之前都是创建CPU端的数据，和描述缓冲区的具体布局
    // 这里才是在GPU端设置内存(缓冲区)
    passEncoder.setVertexBuffer(0, this.positionBuffer);
    passEncoder.setVertexBuffer(1, this.colorBuffer);
    passEncoder.draw(6);

    passEncoder.end();

    const commandBuffer = commandEncoder.finish();
    this.device.queue.submit([commandBuffer]);
  }
}

const renderer = new Renderer();
renderer.initialize().then(() => renderer.draw());