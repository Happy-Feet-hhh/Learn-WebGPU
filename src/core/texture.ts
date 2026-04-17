/**
 * 纹理模块 (Texture Module)
 *
 * 本文件封装了 WebGPU 纹理（GPUTexture）和采样器（GPUSampler）的创建与管理。
 * 纹理是 GPU 上用于存储图像数据的二维资源，是渲染管线中纹理映射（Texture Mapping）
 * 的核心组件。采样器则定义了如何从纹理中读取像素值，包括过滤模式和寻址模式。
 *
 * WebGPU 纹理核心概念：
 * - GPUTexture：GPU 端的图像数据存储对象，类似于 WebGL 中的 WebGLTexture
 * - GPUSampler：定义纹理采样方式的对象，控制放大/缩小过滤、纹理环绕等行为
 * - 纹理格式（Texture Format）：定义纹素（texel）在内存中的编码方式
 * - 纹理用途标志（Texture Usage Flags）：声明纹理将如何被使用，影响 GPU 的内存布局优化
 */

export class Texture {

    /**
     * 构造函数 - 创建 Texture 实例
     *
     * @param texture - GPUTexture 对象，WebGPU 中用于存储图像像素数据的 GPU 资源。
     *                  GPUTexture 是不可变的资源视图，一旦创建便不能直接通过 CPU 修改其尺寸和格式。
     *                  数据的写入通过 device.queue 的拷贝操作完成。
     * @param sampler - GPUSampler 对象，定义着色器在采样纹理时使用的过滤和寻址策略。
     *                  例如 "nearest"（最近邻）过滤会直接取最近的纹素，产生像素化的硬边效果，
     *                  而 "linear"（线性）过滤会对相邻纹素进行双线性插值，产生平滑的过渡效果。
     * @param id      - 纹理的唯一标识符（通常为图像的 URL 或自定义标签），用于缓存管理和调试追踪。
     * @param width   - 纹理的宽度（像素）
     * @param height  - 纹理的高度（像素）
     */
    constructor(public texture: GPUTexture, public sampler: GPUSampler, public id: string,
        public width: number,
        public height: number
        ) { }

    /**
     * 从 HTMLImageElement 创建 GPU 纹理（异步工厂方法）
     *
     * 该方法执行以下步骤：
     * 1. 在 GPU 端分配一个指定尺寸和格式的纹理资源
     * 2. 将 HTML 图像数据通过 ImageBitmap 中间格式拷贝到 GPU 纹理中
     * 3. 创建一个采样器对象用于后续的纹理采样操作
     *
     * @param device - GPUDevice 对象，WebGPU 的核心入口点，代表一个逻辑 GPU 设备。
     *                 几乎所有 GPU 资源（纹理、缓冲区、管线等）都通过 device 来创建。
     * @param image  - 已加载完成的 HTMLImageElement，包含源图像数据。
     *                 图像必须已完成加载（onload 已触发），否则尺寸可能为 0。
     * @returns Promise<Texture> - 包装了 GPUTexture、GPUSampler 和元数据的 Texture 实例
     */
    public static async createTexture(device: GPUDevice, image: HTMLImageElement): Promise<Texture> {
        /**
         * 创建 GPUTexture
         *
         * - size：纹理的尺寸，以像素为单位。WebGPU 要求纹理尺寸不超过设备限制（通常为 8192 或更高）。
         * - format："rgba8unorm" - 纹理格式，表示每个纹素使用 4 个字节存储：
         *   · r (Red)、g (Green)、b (Blue)、a (Alpha) 各 8 位无符号归一化（unorm）
         *   · "unorm" 表示值从 [0, 255] 映射到 [0.0, 1.0] 的浮点范围
         *   · 这是图像纹理的标准格式，几乎所有 GPU 都原生支持
         *
         * - usage：纹理用途标志的位掩码组合，WebGPU 要求在创建时声明用途以优化底层资源分配：
         *   · COPY_DST：允许该纹理作为拷贝操作的目标（即可通过 device.queue.copyExternalImageToTexture
         *     等方法向其写入数据）。没有此标志，将无法向纹理上传像素数据。
         *   · TEXTURE_BINDING：允许该纹理在着色器中被绑定为纹理资源（@binding(0) @group(0) var tex: texture_2d<f32>），
         *     这是渲染时从纹理采样的前提条件。
         *   · RENDER_ATTACHMENT：允许该纹理被用作渲染通道（Render Pass）的附件（颜色附件或深度/模板附件），
         *     即可以作为 renderPassDescriptor 中 colorAttachments 的 view。
         */
        const texture = device.createTexture({
            size: { width: image.width, height: image.height },
            format: "rgba8unorm",
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });

        /**
         * createImageBitmap - 将 HTMLImageElement 转换为 ImageBitmap
         *
         * ImageBitmap 是一种高效的图像位图表示，专为 GPU 操作设计：
         * - 图像数据已被解码并存储在 GPU 友好的内存布局中
         * - 支持 ImageBitmapRenderingContext 的快速绘制
         * - 与直接使用 HTMLImageElement 相比，避免了每次拷贝时的重复解码开销
         *
         * copyExternalImageToTexture 是 WebGPU 提供的高效纹理上传 API：
         * - 直接从外部图像源（ImageBitmap、HTMLCanvasElement 等）拷贝像素数据到 GPUTexture
         * - 比 writeTexture 更高效，因为它利用了浏览器内部的图像管线
         * - 自动处理颜色空间转换和格式适配
         *
         * @param source - 源图像，指定要拷贝的外部图像对象
         * @param destination - 目标纹理，指定数据要写入的 GPUTexture
         * @param copySize - 拷贝区域的尺寸（宽高），必须不超过源图像和目标纹理的尺寸
         */
        const data = await createImageBitmap(image);

        device.queue.copyExternalImageToTexture(
            { source: data },
            { texture: texture },
            { width: image.width, height: image.height }
        );

        /**
         * 创建 GPUSampler - 纹理采样器
         *
         * 采样器定义了着色器在读取纹理坐标（UV 坐标）时的像素检索策略：
         *
         * - magFilter：放大过滤（Magnification Filter）
         *   当纹理被放大显示（一个纹素覆盖多个屏幕像素）时的采样方式：
         *   · "nearest"：最近邻过滤，直接取最近的纹素值，速度最快，产生锐利的像素风格效果
         *   · "linear"：线性过滤，对周围 4 个纹素进行加权平均，产生平滑的过渡效果
         *
         * - minFilter：缩小过滤（Minification Filter）
         *   当纹理被缩小显示（多个纹素映射到同一个屏幕像素）时的采样方式：
         *   · "nearest"：最近邻过滤，可能丢失细节但保持锐利
         *   · "linear"：线性过滤，能更好地保留细节
         *
         * 注意：此处使用 "nearest"/"nearest" 组合，适合像素风格游戏或需要精确纹素映射的场景。
         * 对于需要平滑缩放的纹理（如照片、渐变图），通常使用 "linear"/"linear"。
         * 如需更高质量的缩小效果，还可以配合生成 mipmap 并使用 "linear" 缩小过滤。
         */
        const sampler = device.createSampler({
            magFilter: "nearest",
            minFilter: "nearest",
        });

        return new Texture(texture, sampler, image.src, image.width, image.height);
    }

    /**
     * 创建空白纹理（异步工厂方法）
     *
     * 空白纹理通常用作渲染目标（Render Target），例如：
     * - 后处理（Post-processing）的中间缓冲区
     * - 延迟渲染（Deferred Rendering）的 G-Buffer
     * - 阴影贴图（Shadow Map）
     * - 屏幕空间效果的输入/输出
     *
     * @param device  - GPUDevice 对象
     * @param width   - 纹理宽度（像素）
     * @param height  - 纹理高度（像素）
     * @param format  - 纹理格式，默认为 "bgra8unorm"。
     *                  · "bgra8unorm"：每个纹素 4 字节（Blue, Green, Red, Alpha 各 8 位无符号归一化），
     *                    注意通道顺序为 BGRA 而非 RGBA，这是大多数桌面 GPU 的原生交换链格式，
     *                    因此用作渲染目标时无需额外的格式转换，性能最优。
     *                  · 与 "rgba8unorm" 的区别：仅通道排列顺序不同（BGRA vs RGBA），
     *                    但在 GPU 内部内存布局可能不同。选择与渲染目标匹配的格式可以避免隐式转换开销。
     * @param label   - 纹理的调试标签，用于在 GPU 调试工具（如 PIX、RenderDoc）中标识该资源
     * @returns Promise<Texture> - 包装了空白 GPUTexture 的 Texture 实例
     */
    public static async createEmptyTexture(
        device: GPUDevice, width: number, height: number, 
        format: GPUTextureFormat = "bgra8unorm", label: string = ""): Promise<Texture> {

        /**
         * 创建空白 GPUTexture
         *
         * 用途标志与 createTexture 相同：
         * - COPY_DST：允许后续通过 writeTexture 或拷贝操作写入数据
         * - TEXTURE_BINDING：允许在着色器中采样此纹理（例如在后处理管线中读取上一 Pass 的结果）
         * - RENDER_ATTACHMENT：允许作为渲染通道的颜色附件（这是作为 Render Target 的必要条件）
         */
        const texture = device.createTexture({
            label,
            size: { width: width, height: height },
            format: format,
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });

        /**
         * 为空白纹理创建采样器
         * 即使纹理初始为空，后续也可能需要在着色器中采样此纹理（例如读取渲染结果），
         * 因此预先创建采样器。
         */
        const sampler = device.createSampler({
            magFilter: "nearest",
            minFilter: "nearest",
        });

        return new Texture(texture, sampler, label, width, height);
    }

    /**
     * 从 URL 异步加载并创建纹理（异步工厂方法）
     *
     * 该方法封装了图像加载和纹理创建的完整流程：
     * 1. 创建 HTMLImageElement 并设置 src 为指定 URL
     * 2. 等待浏览器的异步图像解码完成（onload 事件）
     * 3. 调用 createTexture 将图像数据上传到 GPU
     *
     * 注意：由于浏览器的同源策略（CORS），加载跨域图像时需要服务器返回正确的 CORS 头。
     * 如果需要加载跨域图像，应在设置 src 之前设置 image.crossOrigin = "anonymous"。
     *
     * @param device - GPUDevice 对象
     * @param url    - 图像资源的 URL 地址（可以是相对路径、绝对路径或 data URI）
     * @returns Promise<Texture> - 加载并创建完成的 Texture 实例
     * @throws 当图像加载失败时（如 URL 无效、网络错误、CORS 限制），Promise 会被 reject
     */
    public static async createTextureFromURL(device: GPUDevice, url: string): Promise<Texture> {
        const promise = new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.src = url;
            image.onload = () => resolve(image);
            image.onerror = () => {
                console.error(`Failed to load image ${url}`);
                reject();
            }
        });

        const image = await promise;
        return Texture.createTexture(device, image);
    }
}
