// input-manager.ts - 输入管理器
// 封装键盘输入的状态管理，提供按键状态的查询接口
// 通过监听 window 的 keydown/keyup 事件，维护一个按键状态字典

export class InputManager 
{
    // 按键状态字典：键为按键名称（如 "ArrowUp"、"a"、" "），
    // 值为布尔值（true 表示按下，false/undefined 表示松开）
    private keyDown: { [key: string]: boolean } = {};

    constructor()
    {
        // 监听键盘按下事件：将对应按键标记为按下（true）
        window.addEventListener("keydown", (e) => this.keyDown[e.key] = true);

        // 监听键盘松开事件：将对应按键标记为松开（false）
        window.addEventListener("keyup", (e) => this.keyDown[e.key] = false);
    }

    // 查询指定按键是否处于按下状态
    // 注意：如果按键从未被按过，返回 undefined（falsy），行为等同于 false
    public isKeyDown(key: string): boolean 
    {
        return this.keyDown[key];
    }

    // 查询指定按键是否处于松开状态
    public isKeyUp(key: string): boolean 
    {
        return !this.keyDown[key];
    }
}
