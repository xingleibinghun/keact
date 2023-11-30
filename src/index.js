/**
 * 创建专属的 element 数据结构
 */
function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child)
      ),
    },
  };
}
/**
 * 存储原始值（字符串或数字）
 */
function createTextElement(text) {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

function createDom(fiber) {
  // 创建节点
  const dom =
    fiber.type === "TEXT_ELEMENT"
      ? // 空白节点即可，nodeValue prop 会填充文本
      document.createTextNode("")
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);

  return dom;
}

/**
 * 更新 DOM 节点
 */
const isEvent = (key) => key.startsWith("on");
const isProperty = (key) => key !== "children" && !isEvent(key);
const isNew = (prev, next) => (key) => prev[key] !== next[key];
const isGone = (prev, next) => (key) => !(key in next);
function updateDom(dom, prevProps, nextProps) {
  // 移除旧的/已修改的事件监听器
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });
  // 移除旧 props
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = "";
    });
  // 添加/更新 props
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = nextProps[name];
    });
  // 添加事件监听器
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });
}

/**
 * 将整个 Fiber 树提交给 DOM
 */
function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  // 提交完后，当前视图内容是 wipRoot，所以更新 currentRoot
  currentRoot = wipRoot;
  wipRoot = null;
}

/**
 * 将一个个 Fiber 提交到 DOM
 */
function commitWork(fiber) {
  if (!fiber) return;

  // 函数组件没有 DOM 节点，沿着 Fiber tree 一直往上查找，直到找到具有 DOM 节点的 Fiber
  let domParentFiber = fiber.parent;
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  const domParent = domParentFiber.dom;

  if (fiber.effectTag === "PLACEMENT" && fiber.dom !== null) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom !== null) {
    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent);
  }
  commitWork(fiber.child);
  commitWork(fiber.sibling);
}
function commitDeletion(fiber, domParent) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    // 函数组件没有 DOM 节点，沿着 Fiber tree 一直往下查找，直到找到具有 DOM 节点的 Fiber
    commitDeletion(fiber.child, domParent);
  }
}

function render(element, container) {
  // 更新 wipRoot
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  deletions = [];
  // 从 Fiber tree root 开始
  nextUnitOfWork = wipRoot;
}

// 下一个工作单元
let nextUnitOfWork = null;
// 正在进行的 root
let wipRoot = null;
// 当前视图内容的 root
let currentRoot = null;
// 要删除的旧节点（由于将 Fiber 树提交到 DOM 时，我们是从正在进行的 wipRoot 进行操作，wipRoot 中是没有旧 Fiber，所以维护一个删除数组）
let deletions = null;

/**
 * 工作循环
 */
function workLoop(dealine) {
  // 是否让步给一些高优先级的任务（用户输入、动画等）
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    // timeRemaining() 返回当前闲置周期的预估剩余毫秒数
    shouldYield = dealine.timeRemaining() < 1;
  }

  // 完成所有工作后，将整个 Fiber 树提交给 DOM
  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

/**
 * 执行工作单位
 */
function performUnitOfWork(fiber) {
  const isFunction = fiber.type instanceof Function;
  if (isFunction) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  /**
   * 返回下一个工作单元
   *  child -> sibling -> parent.child -> ...
   */
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}

let wipFiber = null;
let hookIndex = null;

/**
 * 函数组件
 *  没有 DOM 节点
 *  children 来自函数返回值，而不是 props.children
 */
function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  // 以支持 useState 在同一个组件中多次调用
  wipFiber.hooks = [];

  // fiber.type 是 App 函数
  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

function useState(initial) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex];
  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [], // 多次调用同个 setState
  };

  // 在下一次渲染组件时更新 state
  const actions = oldHook ? oldHook.queue : [];
  actions.forEach((action) => {
    hook.state = action(hook.state);
  });

  const setState = (action) => {
    hook.queue.push(action);
    /**
     * 执行与 render 函数类似的操作
     */
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    };
    nextUnitOfWork = wipRoot;
    deletions = [];
  };

  wipFiber.hooks.push(hook);
  ++hookIndex;
  return [hook.state, setState];
}

/**
 * 针对 <h1>Hi {props.name}</h1>
 */
function updateHostComponent(fiber) {
  /**
   * 将元素添加到 DOM
   */
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  /**
   * 为子元素创建 Fiber
   */
  reconcileChildren(fiber, fiber.props.children);
}

/**
 * 调和子元素
 */
function reconcileChildren(wipFiber, elements) {
  let index = 0;
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  // 上一个兄弟节点
  let prevSibling = null;

  while (index < elements.length || oldFiber) {
    const element = elements[index];
    let newFiber = null;

    // 对比
    const sameType = oldFiber && element && element.type === oldFiber.type;

    // 更新节点
    if (sameType) {
      newFiber = {
        type: oldFiber.type,
        props: element.props, // 更新属性
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber, // alternate 指针
        effectTag: "UPDATE", // effectTag 标记
      };
    }
    // 添加节点
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null, // 新节点没有 dom
        parent: wipFiber,
        alternate: null, // 新节点所以没有 alternate
        effectTag: "PLACEMENT",
      };
    }
    // 删除旧节点
    if (oldFiber && !sameType) {
      // 由于没有新 Fiber，所以标记添加到旧 Fiber
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    // 更新旧 Fiber
    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    // 第一个子元素，则当前 fiber.child 指向它
    if (index === 0) {
      wipFiber.child = newFiber;
    }
    // 非第一个子元素，则为上一个兄弟节点创建 sibling 指针指向当前 Fiber
    else if (element) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    ++index;
  }
}

const Keact = {
  createElement,
  render,
  useState,
};
// babel 转译 JSX 时使用这个指定函数
/** @jsx Keact.createElement  */
function Counter() {
  const [state, setState] = Keact.useState(1);
  return <h1 onClick={() => setState((c) => c + 1)}>Count: {state}</h1>;
}
const element = <Counter />;
const container = document.getElementById("root");
Keact.render(element, container);
