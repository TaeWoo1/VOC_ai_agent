/**
 * Cross-cutting primitives shared by every domain package.
 *
 * <p>Home of the {@code realDataOnly} filter definition. It lives here rather than on any one entity
 * because it is a property of the whole read surface: a Hibernate filter is global once declared, and
 * declaring it beside the enum it tests keeps the two from drifting.
 */
@FilterDef(
        name = RealDataOnly.NAME,
        // Auto-enabled: the default read is the seller's real data, and a surface that forgets to ask
        // for that must not silently get synthetic rows instead. Opting out is the deliberate act.
        autoEnabled = true,
        parameters = @ParamDef(
                name = RealDataOnly.PARAM,
                type = Boolean.class,
                resolver = SyntheticDataVisibility.class))
package com.sellerops.common;

import org.hibernate.annotations.FilterDef;
import org.hibernate.annotations.ParamDef;
