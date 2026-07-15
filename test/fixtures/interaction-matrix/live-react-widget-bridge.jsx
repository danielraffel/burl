import React, { useLayoutEffect, useRef, useState, version as reactVersion } from 'react';
import { Button, Label, View, render } from '@pulp/react';

globalThis.__burlMatrixRuntime = {
    reactVersion,
    renderer: '@pulp/react-react-reconciler',
    hooks: ['useState', 'useLayoutEffect', 'useRef'],
};

// Real React/Fiber source-side fixture for the backend-neutral interaction
// matrix. Product behavior is intentionally absent: this is the smallest
// hook/state/callback composition that exercises pointer, keyboard, overlay,
// outside-click, reconciliation, layout, and paint through WidgetBridge.
function InteractionMatrixFixture() {
    const [hovered, setHovered] = useState(false);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [selected, setSelected] = useState('none');
    const callbackCount = useRef(0);

    const record = (callback) => {
        callbackCount.current += 1;
        callback();
    };

    useLayoutEffect(() => {
        globalThis.__burlMatrixState = {
            hovered: hovered ? 'true' : 'false',
            'menu.open': open ? 'true' : 'false',
            'active.index': String(activeIndex),
            selected,
            'callback.count': String(callbackCount.current),
        };
    }, [hovered, open, activeIndex, selected]);

    useLayoutEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'ArrowDown') {
                record(() => setActiveIndex(1));
            } else if (event.key === 'Enter') {
                record(() => {
                    setSelected('second');
                    setOpen(false);
                });
            } else if (event.key === 'Escape') {
                record(() => setOpen(false));
            }
        };
        const onOutside = (event) => {
            if (event.target == null) record(() => setOpen(false));
        };
        window.addEventListener('keydown', onKeyDown);
        document.addEventListener('mousedown', onOutside);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('mousedown', onOutside);
        };
    }, []);

    return React.createElement(
        View,
        {
            id: 'fixture-root',
            width: 320,
            height: 180,
            padding: 16,
            gap: 10,
            background: '#121212',
        },
        React.createElement(
            Button,
            {
                id: 'fixture-menu-trigger',
                role: 'button',
                accessibilityLabel: 'Fixture menu',
                width: 180,
                height: 40,
                background: hovered ? '#26384a' : '#202020',
                textColor: '#f5f5f5',
                onMouseEnter: () => record(() => setHovered(true)),
                onClick: () => record(() => setOpen(true)),
            },
            'Fixture menu',
        ),
        React.createElement(
            Label,
            {
                id: 'fixture-status',
                width: 260,
                height: 24,
                textColor: '#b8b8b8',
            },
            `selected:${selected}`,
        ),
        open && React.createElement(
            View,
            {
                id: 'fixture-menu-surface',
                role: 'listbox',
                overlay: true,
                width: 180,
                height: 52,
                padding: 6,
                background: '#2b2b2b',
            },
            React.createElement(
                Button,
                {
                    id: 'fixture-menu-option',
                    role: 'option',
                    accessibilityLabel: 'Second option',
                    width: 168,
                    height: 40,
                    background: activeIndex === 1 ? '#315d83' : '#252525',
                    textColor: '#ffffff',
                    onClick: () => record(() => {
                        setSelected('second');
                        setOpen(false);
                    }),
                },
                'Second option',
            ),
        ),
    );
}

export default InteractionMatrixFixture;

render(React.createElement(InteractionMatrixFixture));
layout();
