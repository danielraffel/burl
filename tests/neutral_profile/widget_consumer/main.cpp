#include <pulp/view/widgets.hpp>

int main() {
    pulp::view::ImageView image;
    image.set_fill_value(0.5f);

    pulp::view::XYPad pad;
    pad.set_x(0.25f);
    pad.set_y(0.75f);

    pulp::view::Panel panel;
    panel.set_corner_radius(6.0f);

    return image.fill_value() == 0.5f && pad.x_value() == 0.25
               && panel.corner_radius() == 6.0f
           ? 0
           : 1;
}
