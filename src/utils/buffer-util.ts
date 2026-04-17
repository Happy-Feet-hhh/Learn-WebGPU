/**
 * BufferUtil - WebGPU 缓冲区工具类
 *
 * 提供创建不同类型 GPUBuffer 的静态工厂方法。
 * WebGPU 中有三种主要的缓冲区类型：
 *   - VERTEX（顶点缓冲区）：存储顶点数据（位置、UV、颜色等），供顶点着色器读取
 *   - INDEX（索引缓冲区）：存储索引数据（Uint16Array），定义顶点的连接顺序，用于绘制三角形
 *   - UNIFORM（统一缓冲区）：存储着色器中需要的一致性数据（如变换矩阵），每帧通过 queue.writeBuffer() 更新
 */
export class BufferUtil {

    /**
     * 创建顶点缓冲区（VertexBuffer）
     *
     * 顶点缓冲区存储每个顶点的属性数据（位置、UV 坐标、颜色等），
     * 在渲染管线中由顶点着色器逐顶点读取。
     *
     * @param device - GPU 设备实例，用于创建缓冲区
     * @param data   - 顶点数据数组（Float32Array），包含所有顶点的属性
     * @returns 创建好的 GPUBuffer
     *
     * 使用说明：
     * - GPUBufferUsage.VERTEX：标记为顶点缓冲区，供渲染管线读取
     * - GPUBufferUsage.COPY_DST：允许通过 queue.writeBuffer() 写入数据，支持后续动态更新
     * - mappedAtCreation: true：在创建时立即映射缓冲区到 CPU 内存，
     *   这样可以直接通过 getMappedRange() 写入初始数据，写入完成后调用 unmap() 解除映射，
     *   GPU 才能读取该缓冲区。这是一种高效的初始数据上传方式。
     */
    public static createVertexBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {

        const buffer = device.createBuffer({
            size: data.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });

        // 将数据写入映射的内存区域：先获取映射范围的 ArrayBuffer 视图，再通过 set() 复制数据
        new Float32Array(buffer.getMappedRange()).set(data);
        // 解除映射，GPU 此后可以访问该缓冲区
        buffer.unmap();

        return buffer;
    }

    /**
     * 创建索引缓冲区（IndexBuffer）
     *
     * 索引缓冲区存储顶点索引（Uint16Array），通过索引引用顶点缓冲区中的顶点，
     * 避免重复存储共享顶点。例如一个矩形只需 4 个顶点 + 6 个索引（2 个三角形），
     * 而不需要 6 个独立顶点（每个三角形 3 个）。
     *
     * @param device - GPU 设备实例
     * @param data   - 索引数据数组（Uint16Array），每个元素是一个顶点索引
     * @returns 创建好的 GPUBuffer
     *
     * 使用说明：
     * - GPUBufferUsage.INDEX：标记为索引缓冲区，供 drawIndexed() 使用
     * - GPUBufferUsage.COPY_DST：允许后续通过 queue.writeBuffer() 更新索引数据
     * - mappedAtCreation: true：创建时映射，直接写入初始索引数据后解除映射
     */
    public static createIndexBuffer(device: GPUDevice, data: Uint16Array): GPUBuffer {

        const buffer = device.createBuffer({
            size: data.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });

        // 将索引数据写入映射的内存区域，使用 Uint16Array 视图匹配索引类型
        new Uint16Array(buffer.getMappedRange()).set(data);
        // 解除映射，使 GPU 可访问
        buffer.unmap();

        return buffer;

    }

    /**
     * 创建统一缓冲区（UniformBuffer）
     *
     * 统一缓冲区用于向着色器传递全局统一的数据，例如投影矩阵、视图矩阵等。
     * 与顶点/索引缓冲区不同，统一缓冲区的数据在每帧渲染时通过
     * device.queue.writeBuffer() 动态更新，因此：
     *   - 不需要 mappedAtCreation（不需要在创建时写入初始数据）
     *   - 需要 COPY_DST 标志以支持 writeBuffer() 操作
     *   - 着色器中通过 @group/binding 访问，使用 uniform 类型
     *
     * @param device - GPU 设备实例
     * @param data   - 用于确定缓冲区大小的数据（Float32Array），注意：此方法不写入该数据
     * @returns 创建好的 GPUBuffer（尚未填充数据，需后续通过 writeBuffer 写入）
     */
    public static createUniformBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
        const buffer = device.createBuffer({
            // 缓冲区大小由传入数据的字节长度决定
            size: data.byteLength,
            // UNIFORM：标记为统一缓冲区，着色器可读取
            // COPY_DST：允许通过 device.queue.writeBuffer() 更新内容
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        return buffer;
    }

}
