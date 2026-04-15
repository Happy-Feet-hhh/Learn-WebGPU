// 从shader源代码引入
import shaderSource from "./shaders/shader.wgsl?raw";
import { QuadGeometry } from "./geometry";
import { Texture } from "./texture";

class Renderer {
  private context!: GPUCanvasContext;
  private device!: GPUDevice;
  private pipeline!: GPURenderPipeline;
  private positionBuffer!: GPUBuffer;
  private colorBuffer!: GPUBuffer;
  // 新增 纹理缓冲区
  private textureBuffer!: GPUBuffer;
  // 新增 纹理绑定组
  private textureBindGroup!: GPUBindGroup;
  // 新增 测试用的图像纹理
  private testTexture!: Texture;

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

    // 新增 创建纹理
    this.testTexture = await Texture.createTextureFromURL(this.device, "src/assets/uv_test.png");

    // 新增 在CPU侧定义好顶点的相关数据 位置 颜色 与 纹理坐标
    // 使用新封装的  QuadGeometry 类
    const geometry = new QuadGeometry();
    // 直接使用 geometry 对象创建 GPUBuffer
    this.positionBuffer = this.createBuffer(new Float32Array(geometry.positions));
    this.colorBuffer = this.createBuffer(new Float32Array(geometry.colors));
    this.textureBuffer = this.createBuffer(new Float32Array(geometry.texCoords));

    // 新增，准备shader module 着色器模块
    this.prepareModel();
  }

  private createBuffer(data: Float32Array): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: data.byteLength, 
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

    // 新增 创建纹理坐标布局 也是顶点缓冲
    const textureCoordsLayout: GPUVertexBufferLayout = {
      arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
      attributes: [
        {
          shaderLocation: 2,
          offset: 0,
          format: "float32x2"
        }
      ],
      stepMode: "vertex"
    };

    const vertexState: GPUVertexState = {
      module: shaderModule,
      entryPoint: "vertexMain",
      buffers: [
        positionBufferLayout,
        colorBufferLayout,
        textureCoordsLayout
      ]
    };

    const fragmentState: GPUFragmentState = {
      module: shaderModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: navigator.gpu.getPreferredCanvasFormat(),
          // 新增 添加混合字段的属性 也就是 fragShader 的 @location(1) 了
          blend: {
            color: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add"
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add"
            }
          }
        }
      ]
    };

    // 由于纹理使用了binding group 所以需要手动定义布局
    const textureBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        // 第一个entries的数组元素，对应@binding(0)
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        // 第二个entries的数组元素，对应@binding(1)
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        }
      ]
    }); 
    
    // 新增 对应的管线布局也要手动创建
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        textureBindGroupLayout
      ]
    });

    // 有了管线布局和绑定组布局后才可以创建绑定组
    this.textureBindGroup = this.device.createBindGroup({
      layout: textureBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: this.testTexture.sampler
        },
        {
          binding: 1,
          resource: this.testTexture.texture.createView()
        }
      ]
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
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
    passEncoder.setVertexBuffer(0, this.positionBuffer);
    passEncoder.setVertexBuffer(1, this.colorBuffer);
    passEncoder.setVertexBuffer(2, this.textureBuffer);
    passEncoder.setBindGroup(0, this.textureBindGroup);
    passEncoder.draw(6);

    passEncoder.end();

    const commandBuffer = commandEncoder.finish();
    this.device.queue.submit([commandBuffer]);
  }
}

const renderer = new Renderer();
renderer.initialize().then(() => renderer.draw());