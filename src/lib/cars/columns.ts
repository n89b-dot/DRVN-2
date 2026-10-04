/**
 * Every column of `cars` a client may read (20261004160000). `vin` is not one
 * of them: it belongs to the car's owner, who reads it through the
 * `my_car_vin` function. A `select("*")` on cars is refused for any client,
 * so pages list these instead.
 */
export const CAR_COLUMNS =
  "id, owner_id, slug, name, make, model, year, color, about, tags, cover_image_url, is_public, created_at, updated_at, trim, engine, drivetrain, body_class, vin_decoded_at, catalog_make_id, catalog_model_id, identity_source, cover_focal_x, cover_focal_y" as const;
